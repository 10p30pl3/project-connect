import re
import os
try:
    import joblib
except ImportError:
    joblib = None

# Padrões Semânticos de Operadoras Telefônicas Brasileiras (Claro, Vivo, Tim, Oi, Embratel, etc.)
PATTERNS_OPERADORA = [
    r'n[uú]mero (?:chamado |discado )?(?:n[aã]o existe|est[aá] bloqueado|n[aã]o recebe)',
    r'est[aá] desligado ou fora (?:da [aá]rea)?',
    r'(?:fora|sem) [aá]rea de cobertura',
    r'impossibilitado de (?:receber|atender)',
    r'n[aã]o foi poss[ií]vel completar (?:sua|a) liga[cç][aã]o',
    r'verifique o n[uú]mero discado',
    r'sua chamada est[aá] sendo encaminhada',
    r'este n[uú]mero est[aá] programado para n[aã]o receber',
    r'servi[cç]o de atendimento da operadora',
    r'chamada n[aã]o permitida',
    r'o telefone que voc[eê] discou',
]

# Padrões Semânticos de Caixas Postais / Secretárias Eletrônicas / Live Voicemail
PATTERNS_CAIXA_POSTAL = [
    r'caixa postal',
    r'caixa de mensage(?:m|ns)',
    r'deixe (?:o )?seu recado',
    r'deixe (?:a )?sua mensagem',
    r'ap[oó]s o sinal',
    r'n[aã]o (?:posso|pode) atender (?:no momento|agora)?',
    r'n[aã]o estou dispon[ií]vel',
    r'grave (?:o |a )?(?:seu|sua) (?:recado|mensagem)',
    r'deixe seu nome e telefone',
    r'assistente de liga[cç][aã]o',
    r'deixe um recado ap[oó]s o bipe',
    r'sua mensagem ser[aá] enviada',
    r'correio de voz',
    r'recado de voz',
    r'(?:por favor )?ligue mais tarde',
]

# Padrões Fortes Dialógicos / Interrogativos de Fala Humana
PATTERNS_HUMANO_FORTE = [
    r'\bal[oô]\b',
    r'\bpronto\b',
    r'\bpois n[aã]o\b',
    r'\bquem fala\b',
    r'\bquem [eé]\b',
    r'\bpode falar\b',
    r'\bcom quem (?:deseja|quer) falar\b',
    r'\bquem gostaria\b',
]

# Saudações Curtas (Só valem como Fast-Path Humano se a fala for curta <= 1300ms e <= 5 palavras)
PATTERNS_SAUDACAO_CURTA = [
    r'\bbom dia\b',
    r'\bboa tarde\b',
    r'\bboa noite\b',
    r'\boi\b',
    r'\bol[aá]\b',
    r'\bsim\b',
    r'\bdiga\b',
]

COMPILED_OPERADORA = [re.compile(p, re.IGNORECASE) for p in PATTERNS_OPERADORA]
COMPILED_CAIXA_POSTAL = [re.compile(p, re.IGNORECASE) for p in PATTERNS_CAIXA_POSTAL]
COMPILED_HUMANO_FORTE = [re.compile(p, re.IGNORECASE) for p in PATTERNS_HUMANO_FORTE]
COMPILED_SAUDACAO_CURTA = [re.compile(p, re.IGNORECASE) for p in PATTERNS_SAUDACAO_CURTA]


class AMDClassifier:
    def __init__(self, model_path: str = None):
        self.model_path = model_path or os.getenv('AMD_MODEL_PATH', 'models/amd_classifier.joblib')
        self.ml_pipeline = None
        self.load_ml_model()

    def load_ml_model(self):
        if joblib is not None and os.path.exists(self.model_path):
            try:
                self.ml_pipeline = joblib.load(self.model_path)
                print(f"[AMDClassifier] Modelo treinado de ML carregado de {self.model_path}")
            except Exception as e:
                print(f"[AMDClassifier] Erro ao carregar modelo ML: {e}. Usando regras heurísticas.")
        else:
            print("[AMDClassifier] Modelo ML não encontrado. Operando com motor heurístico de regras (Fase 0).")

    def classify(self, text: str, speech_ms: int = 0, silence_ms: int = 0, is_early_media: bool = False) -> dict:
        """
        Classifica em: 'humano', 'caixa_postal', 'operadora' ou 'silencio'.
        Retorna dicionário com { label, confidence, reason, probas }
        """
        clean_text = (text or "").strip().lower()
        word_count = len(clean_text.split()) if clean_text else 0

        # 1. Regra de Silêncio Absoluto
        if speech_ms < 150:
            return {
                "label": "silencio",
                "confidence": 0.98,
                "reason": "no_speech_detected",
                "probas": {"silencio": 0.98, "humano": 0.02, "caixa_postal": 0.0, "operadora": 0.0}
            }

        # 2. Padrão Explícito de Caixa Postal
        for pat in COMPILED_CAIXA_POSTAL:
            if pat.search(clean_text):
                return {
                    "label": "caixa_postal",
                    "confidence": 0.95,
                    "reason": f"regex_caixa_postal_match: {pat.pattern}",
                    "probas": {"caixa_postal": 0.95, "humano": 0.05, "operadora": 0.0, "silencio": 0.0}
                }

        # 3. Padrão de Operadora
        for pat in COMPILED_OPERADORA:
            if pat.search(clean_text):
                return {
                    "label": "operadora",
                    "confidence": 0.96,
                    "reason": f"regex_operadora_match: {pat.pattern}",
                    "probas": {"operadora": 0.96, "humano": 0.04, "caixa_postal": 0.0, "silencio": 0.0}
                }

        if is_early_media:
            return {
                "label": "aguardando_200ok",
                "confidence": 0.50,
                "reason": "early_media_non_conclusive",
                "probas": {"humano": 0.50, "operadora": 0.50, "caixa_postal": 0.0, "silencio": 0.0}
            }

        # 4. Se houver modelo de ML treinado, avalia antes das heurísticas genéricas quando a fala for longa
        if self.ml_pipeline is not None and len(clean_text) >= 3 and speech_ms > 1300:
            try:
                probas = self.ml_pipeline.predict_proba([clean_text])[0]
                classes = self.ml_pipeline.classes_
                prob_map = {cls: float(p) for cls, p in zip(classes, probas)}
                best_class = max(prob_map, key=prob_map.get)
                confidence = prob_map[best_class]

                if best_class in ('caixa_postal', 'operadora') and confidence >= 0.90:
                    return {
                        "label": best_class,
                        "confidence": confidence,
                        "reason": "ml_pipeline_high_confidence",
                        "probas": prob_map
                    }
                elif best_class == 'humano' and confidence >= 0.55:
                    return {
                        "label": "humano",
                        "confidence": confidence,
                        "reason": "ml_pipeline_human",
                        "probas": prob_map
                    }
            except Exception:
                pass

        # 5. Padrão Forte Dialógico Humano ("Alô", "Quem fala?", "Pois não")
        if any(pat.search(clean_text) for pat in COMPILED_HUMANO_FORTE):
            return {
                "label": "humano",
                "confidence": 0.92 if speech_ms <= 1500 else 0.85,
                "reason": "strong_human_dialogic_pattern",
                "probas": {"humano": 0.90, "caixa_postal": 0.07, "operadora": 0.03, "silencio": 0.0}
            }

        # 6. Saudação Curta ("Oi?", "Bom dia?") -> Somente se fala curta (<= 1300ms e <= 5 palavras)
        if speech_ms <= 1300 and word_count <= 5 and any(pat.search(clean_text) for pat in COMPILED_SAUDACAO_CURTA):
            return {
                "label": "humano",
                "confidence": 0.88,
                "reason": "short_human_greeting",
                "probas": {"humano": 0.88, "caixa_postal": 0.08, "operadora": 0.04, "silencio": 0.0}
            }

        # 7. Se houver modelo ML e ainda não decidiu nas falas curtas
        if self.ml_pipeline is not None and len(clean_text) >= 3:
            try:
                probas = self.ml_pipeline.predict_proba([clean_text])[0]
                classes = self.ml_pipeline.classes_
                prob_map = {cls: float(p) for cls, p in zip(classes, probas)}
                best_class = max(prob_map, key=prob_map.get)
                confidence = prob_map[best_class]

                if best_class in ('caixa_postal', 'operadora') and confidence >= 0.90:
                    return {
                        "label": best_class,
                        "confidence": confidence,
                        "reason": "ml_pipeline_high_confidence",
                        "probas": prob_map
                    }
                return {
                    "label": "humano",
                    "confidence": prob_map.get("humano", 0.60),
                    "reason": "ml_pipeline_fallback_human",
                    "probas": prob_map
                }
            except Exception:
                pass

        # 8. Heurística de Cadência Temporal para fala contínua longa sem pausa dialógica (alinhado com o gatilho de 1800ms do main.py)
        if speech_ms >= 1800 and silence_ms < 250:
            return {
                "label": "caixa_postal",
                "confidence": 0.78,
                "reason": "long_continuous_speech_heuristic",
                "probas": {"caixa_postal": 0.78, "humano": 0.22, "operadora": 0.0, "silencio": 0.0}
            }

        return {
            "label": "humano",
            "confidence": 0.60,
            "reason": "default_safe_human_fallback",
            "probas": {"humano": 0.60, "caixa_postal": 0.20, "operadora": 0.20, "silencio": 0.0}
        }
