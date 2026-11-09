import asyncio
import time
import os
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from typing import List
from faster_whisper import WhisperModel

AMD_INITIAL_PROMPT_PT = (
    "Alô, quem fala, pois não, quem é, pode falar, com quem deseja falar. "
    "Caixa postal, deixe seu recado após o sinal, não posso atender agora. "
    "O número chamado não existe, está desligado ou fora da área de cobertura."
)

CONVERSATIONAL_PROMPT_PT = (
    "Voll, Voll Solutions, atendimento ao cliente, inteligência artificial, automações, planos, quanto custa, demonstração."
)

# Alucinações clássicas do Whisper em trechos de ruído de linha/silêncio
HALLUCINATION_PHRASES = (
    "obrigado por assistir",
    "legendas pela comunidade",
    "legendado por",
    "inscreva-se no canal",
    "amara.org",
    "subtitles by",
)

class BatchTask:
    def __init__(self, priority: int, audio_np: np.ndarray, initial_prompt: str, future: asyncio.Future):
        self.priority = priority # 0=AMD, 1=STT Live, 2=Batch
        self.audio_np = audio_np
        if initial_prompt:
            self.initial_prompt = initial_prompt
        elif priority == 0:
            self.initial_prompt = AMD_INITIAL_PROMPT_PT
        else:
            self.initial_prompt = CONVERSATIONAL_PROMPT_PT
        self.future = future
        self.created_at = time.time()

class PriorityInferenceWorker:
    def __init__(self):
        self.model_size = os.getenv("WHISPER_MODEL_SIZE", "small")
        self.device = os.getenv("WHISPER_DEVICE", "auto")
        self.compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "auto")
        self.num_workers = int(os.getenv("WHISPER_NUM_WORKERS", "4"))
        self.max_batch_size = int(os.getenv("WHISPER_MAX_BATCH_SIZE", "8"))
        self.micro_batch_window_sec = float(os.getenv("WHISPER_BATCH_WINDOW_SEC", "0.040"))

        self.queue: List[BatchTask] = []
        self.lock = asyncio.Lock()
        self.running = False
        self.model = None
        self.executor = ThreadPoolExecutor(max_workers=self.num_workers)

    def load_model(self):
        print(
            f"[PriorityWorker] Carregando modelo Whisper '{self.model_size}' "
            f"(Device: {self.device}, Compute: {self.compute_type}, Workers C++: {self.num_workers})..."
        )
        self.model = WhisperModel(
            self.model_size,
            device=self.device,
            compute_type=self.compute_type,
            num_workers=self.num_workers
        )
        dummy = np.zeros(16000, dtype=np.float32)
        try:
            segments, _ = self.model.transcribe(dummy, language="pt", beam_size=1)
            list(segments)
            print("[PriorityWorker] ✅ Warmup concluído com sucesso!")
        except Exception as e:
            print(f"[PriorityWorker] Warmup avisou: {e}")

    async def start(self):
        self.running = True
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(self.executor, self.load_model)
        asyncio.create_task(self._worker_loop())

    async def submit_task(self, audio_np: np.ndarray, priority: int = 1, initial_prompt: str = None) -> str:
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        task = BatchTask(priority, audio_np, initial_prompt, future)

        async with self.lock:
            inserted = False
            for i, t in enumerate(self.queue):
                if task.priority < t.priority:
                    self.queue.insert(i, task)
                    inserted = True
                    break
            if not inserted:
                self.queue.append(task)

        return await future

    async def _worker_loop(self):
        loop = asyncio.get_running_loop()

        while self.running:
            if not self.queue:
                await asyncio.sleep(0.005)
                continue

            # Se houver tarefa de AMD prioritária (P0) pronta, usa micro-janela ultrarrápida (10ms)
            has_p0 = any(t.priority == 0 for t in self.queue)
            batch_wait = 0.010 if has_p0 else self.micro_batch_window_sec
            await asyncio.sleep(batch_wait)

            async with self.lock:
                batch_tasks = self.queue[:self.max_batch_size]
                self.queue = self.queue[self.max_batch_size:]

            if not batch_tasks:
                continue

            # Executa todas as tasks do micro-batch simultaneamente nos workers C++/CUDA do CTranslate2 (que libera o GIL)
            try:
                results = await asyncio.gather(
                    *[loop.run_in_executor(self.executor, self._transcribe_single, task) for task in batch_tasks],
                    return_exceptions=True
                )
                for task, result in zip(batch_tasks, results):
                    if not task.future.done():
                        if isinstance(result, Exception):
                            task.future.set_result("")
                        else:
                            task.future.set_result(result)
            except Exception as e:
                for task in batch_tasks:
                    if not task.future.done():
                        task.future.set_exception(e)

    def _transcribe_single(self, task: BatchTask) -> str:
        if task.audio_np is None or len(task.audio_np) < 800:
            return ""
        try:
            segments, _ = self.model.transcribe(
                task.audio_np,
                language="pt",
                beam_size=1,
                best_of=1,
                temperature=0.0,
                condition_on_previous_text=False,
                without_timestamps=True,
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=250,
                    speech_pad_ms=150
                ),
                no_speech_threshold=0.6,
                initial_prompt=task.initial_prompt
            )
            text = " ".join([s.text for s in segments]).strip()
            lower_text = text.lower()
            for hall in HALLUCINATION_PHRASES:
                if hall in lower_text:
                    return ""
            return text
        except Exception as err:
            print(f"[PriorityWorker] Erro na transcrição de task: {err}")
            return ""

    def stop(self):
        self.running = False
        self.executor.shutdown(wait=False)
