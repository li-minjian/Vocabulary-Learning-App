import json
import google.generativeai as genai
from config import Config

def init_genai():
    if not Config.GEMINI_API_KEY:
        print("Warning: GEMINI_API_KEY not found in .env. AI features will be disabled.")
        return False
    genai.configure(api_key=Config.GEMINI_API_KEY)
    return True

is_ai_ready = init_genai()

def sanitize_ipa(ipa):
    if ipa is None:
        return ""
    ipa = str(ipa).strip()
    if not ipa:
        return ""
    # Normalize slashes
    if not ipa.startswith("/"):
        ipa = f"/{ipa}"
    if not ipa.endswith("/"):
        ipa = f"{ipa}/"
    return ipa

def enrich_word(word: str, language: str = "English", context: str = "", native_language: str = "Chinese") -> dict:
    if not is_ai_ready:
        raise Exception("AI service not configured")
        
    model = genai.GenerativeModel(Config.GEMINI_MODEL)
    
    prompt = f"""
    You are a language learning assistant. The user wants to learn the {language} word: '{word}'.
    Context where they found it (if any): '{context}'
    
    Please provide the following information about this word in JSON format.
    The response MUST be a raw JSON object (no markdown code blocks, just the JSON).
    
    Expected JSON schema:
    {{
      "word": "{word}",
      "ipa": "IPA phonetic transcription for English words, e.g., /ˈtrɪɡər/ (optional, empty string if unavailable or not English)",
      "translation": "Primary translation of the word in {native_language}",
      "pos": "Part of speech (e.g., noun, verb, adjective)",
      "definition": "A clear, concise definition in {native_language}",
      "examples": [
        {{
          "sentence": "Example sentence 1 in {language}",
          "translation": "Translation of the sentence in {native_language}"
        }},
        {{
          "sentence": "Example sentence 2 in {language}",
          "translation": "Translation of the sentence in {native_language}"
        }}
      ],
      "collocations": ["common phrase 1 in {language}", "common phrase 2 in {language}"],
      "synonyms": ["synonym1 in {language}", "synonym2 in {language}"],
      "relatedWords": ["related1 in {language}", "related2 in {language}"]
    }}

    Prompt rules:
    - For each English vocabulary item, include an IPA phonetic transcription in the field "ipa".
    - Use standard IPA notation.
    - Wrap IPA in slashes, for example /ˈtrɪɡər/.
    - Choose the pronunciation that matches the meaning and part of speech in context.
    - If uncertain, return an empty string.
    - Do not omit the "ipa" field.
    """
    
    response = model.generate_content(prompt)
    
    # Try to parse the response text as JSON. Remove markdown if present.
    text = response.text.strip()
    if text.startswith("```json"):
        text = text.replace("```json", "", 1)
    if text.endswith("```"):
        text = text[:-3]
        
    try:
        res = json.loads(text.strip())
        res["ipa"] = sanitize_ipa(res.get("ipa", ""))
        return res
    except Exception as e:
        print(f"Failed to parse AI response: {text}")
        raise Exception("Failed to parse AI response into JSON")

def bulk_enrich_words(words: list, language: str = "English", native_language: str = "Chinese") -> list:
    if not is_ai_ready:
        raise Exception("AI service not configured")
        
    model = genai.GenerativeModel(Config.GEMINI_MODEL)
    
    words_list = ", ".join([w.get('word', w) if isinstance(w, dict) else str(w) for w in words])
    
    prompt = f"""
    You are a language learning assistant. The user wants to learn the following {language} words:
    {words_list}
    
    Please provide the enriched information for EVERY word in a JSON array format.
    The response MUST be a raw JSON array of objects (no markdown code blocks, just the JSON).
    
    Expected JSON schema for EACH object in the array:
    {{
      "word": "The original word",
      "ipa": "IPA phonetic transcription for English words, e.g., /ˈtrɪɡər/ (optional, empty string if unavailable or not English)",
      "translation": "Primary translation of the word in {native_language}",
      "pos": "Part of speech (e.g., noun, verb, adjective)",
      "definition": "A clear, concise definition in {native_language}",
      "examples": [
        {{
          "sentence": "Example sentence 1 in {language}",
          "translation": "Translation of the sentence in {native_language}"
        }},
        {{
          "sentence": "Example sentence 2 in {language}",
          "translation": "Translation of the sentence in {native_language}"
        }}
      ],
      "collocations": ["common phrase 1 in {language}", "common phrase 2 in {language}"],
      "synonyms": ["synonym1 in {language}", "synonym2 in {language}"],
      "relatedWords": ["related1 in {language}", "related2 in {language}"]
    }}

    Prompt rules:
    - For each English vocabulary item, include an IPA phonetic transcription in the field "ipa".
    - Use standard IPA notation.
    - Wrap IPA in slashes, for example /ˈtrɪɡər/.
    - Choose the pronunciation that matches the meaning and part of speech in context.
    - If uncertain, return an empty string.
    - Do not omit the "ipa" field.
    """
    
    response = model.generate_content(prompt)
    
    text = response.text.strip()
    if text.startswith("```json"):
        text = text.replace("```json", "", 1)
    if text.endswith("```"):
        text = text[:-3]
        
    try:
        items = json.loads(text.strip())
        if isinstance(items, list):
            for item in items:
                item["ipa"] = sanitize_ipa(item.get("ipa", ""))
        return items
    except Exception as e:
        print(f"Failed to parse bulk AI response: {text}")
        raise Exception("Failed to parse AI response into JSON")

def analyze_text_for_words(text: str, target_language: str = "English", level: str = "Intermediate", goal: str = "General", count: int = 10, native_language: str = "Chinese") -> list:
    if not is_ai_ready:
        raise Exception("AI service not configured")
        
    model = genai.GenerativeModel(Config.GEMINI_MODEL)
    
    prompt = f"""
    You are a language learning assistant helping a student learn {target_language}. The student is at a {level} level and their primary goal is {goal}.
    Read the following text and extract exactly {count} important, difficult, or useful words/phrases for this specific learner.
    
    Text:
    \"\"\"{text}\"\"\"
    
    Please provide the result in JSON format.
    The response MUST be a raw JSON array of objects (no markdown code blocks, just the JSON array).
    
    Expected JSON schema:
    [
      {{
        "word": "extracted word",
        "ipa": "IPA phonetic transcription for English words, e.g., /ˈtrɪɡər/ (optional, empty string if unavailable or not English)",
        "translation": "translation in {native_language}",
        "pos": "part of speech",
        "context": "the sentence from the text where it appears"
      }}
    ]

    Prompt rules:
    - For each English vocabulary item, include an IPA phonetic transcription in the field "ipa".
    - Use standard IPA notation.
    - Wrap IPA in slashes, for example /ˈtrɪɡər/.
    - Choose the pronunciation that matches the meaning and part of speech in context.
    - If uncertain, return an empty string.
    - Do not omit the "ipa" field.
    """
    
    response = model.generate_content(prompt)
    
    text_res = response.text.strip()
    if text_res.startswith("```json"):
        text_res = text_res.replace("```json", "", 1)
    if text_res.endswith("```"):
        text_res = text_res[:-3]
        
    try:
        items = json.loads(text_res.strip())
        if isinstance(items, list):
            for item in items:
                item["ipa"] = sanitize_ipa(item.get("ipa", ""))
        return items
    except Exception as e:
        print(f"Failed to parse AI response: {text_res}")
        raise Exception("Failed to parse AI response into JSON")

def extract_uploaded_document(path, mime_type: str) -> str:
    """Only called after explicit consent; provider file removed after extraction."""
    if not is_ai_ready:
        raise Exception('AI service not configured')
    uploaded = None
    try:
        uploaded = genai.upload_file(path=str(path), mime_type=mime_type)
        import time
        deadline = time.monotonic() + 30
        while getattr(getattr(uploaded, 'state', None), 'name', '') == 'PROCESSING':
            if time.monotonic() >= deadline:
                raise TimeoutError('Provider document processing timed out')
            time.sleep(1)
            uploaded = genai.get_file(uploaded.name)
        if getattr(getattr(uploaded, 'state', None), 'name', '') == 'FAILED':
            raise ValueError('Provider rejected document')
        response = genai.GenerativeModel(Config.GEMINI_MODEL).generate_content([
            uploaded, 'Extract the document text accurately in its original language, preserving paragraphs.'],
            request_options={'timeout': 60, 'retry': None})
        return response.text.strip()
    finally:
        if uploaded is not None:
            try:
                genai.delete_file(uploaded.name)
            except Exception:
                print('[DOCUMENT_EXTRACTION] provider cleanup could not be confirmed', flush=True)


def check_typo(text: str, typed_word: str) -> dict:
    if not is_ai_ready:
        raise Exception("AI service not configured")
        
    model = genai.GenerativeModel(Config.GEMINI_MODEL)
    prompt = f"""
    You are a spelling checker. The user typed the word '{typed_word}' which they claim is from the following text.
    
    Text:
    \"\"\"{text}\"\"\"
    
    Check if '{typed_word}' is exactly in the text. If it is NOT in the text, check if they made a typo of a word that IS in the text.
    If it's a typo, suggest the correct spelling from the text.
    If the word is nowhere to be found and not a typo, say it's not found.
    
    Return ONLY a raw JSON object (no markdown):
    {{
      "is_typo": boolean (true if they misspelled a word in the text),
      "corrected_word": "the correct spelling from the text if is_typo is true, otherwise null",
      "not_found": boolean (true if the word is neither in the text nor a typo of a word in the text)
    }}
    """
    
    response = model.generate_content(prompt)
    res_text = response.text.strip()
    if res_text.startswith("```json"): res_text = res_text.replace("```json", "", 1)
    if res_text.endswith("```"): res_text = res_text[:-3]
        
    try:
        return json.loads(res_text.strip())
    except:
        return {"is_typo": False, "corrected_word": None, "not_found": False}
