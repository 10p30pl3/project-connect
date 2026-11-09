import re

# Padrões comuns em português para dados sensíveis falados ou transcritos (suporta pontos, vírgulas, hífens e espaços)
CPF_REGEX = re.compile(r'\b(?:\d{3}[\.\,\-\s]*\d{3}[\.\,\-\s]*\d{3}[\.\,\-\s]*\d{2}|\d{11})\b')
CARD_REGEX = re.compile(r'\b(?:\d{4}[\.\,\-\s]*){3}\d{4}\b')
PHONE_REGEX = re.compile(r'\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}[\.\,\-\s]*\d{4}|\d{4}[\.\,\-\s]*\d{4})\b')
EMAIL_REGEX = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b')

def redact_pii(text: str) -> str:
    """
    Mascara dados de identificação pessoal (LGPD) em transcrições de voz
    """
    if not text:
        return text

    # Redige CPF
    redacted = CPF_REGEX.sub('***.***.***-**', text)
    # Redige número de cartão de crédito
    redacted = CARD_REGEX.sub('****-****-****-****', redacted)
    # Redige Email
    redacted = EMAIL_REGEX.sub('***@***.***', redacted)
    
    return redacted
