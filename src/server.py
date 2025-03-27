# --- Begin Monkey Patches (must be at the very top) ---
import torch
import transformers

# Patch torch.compiler if not available (needed for Transformers integrations)
if not hasattr(torch, "compiler"):
    class DummyCompiler:
        @staticmethod
        def disable(recursive=False):
            def decorator(func):
                return func
            return decorator
    torch.compiler = DummyCompiler()

# Patch PreTrainedModel.load_state_dict to remove the unexpected "assign" argument
old_load_state_dict = transformers.modeling_utils.PreTrainedModel.load_state_dict

def new_load_state_dict(self, state_dict, strict=True, **kwargs):
    if "assign" in kwargs:
        del kwargs["assign"]
    return old_load_state_dict(self, state_dict, strict=strict, **kwargs)

transformers.modeling_utils.PreTrainedModel.load_state_dict = new_load_state_dict
# --- End Monkey Patches ---

import os
import logging
import gc
import tempfile
import shutil
from flask import Flask, request, jsonify
from flask_cors import CORS
from pyngrok import ngrok
import whisper
from transformers import AutoTokenizer, AutoModelForCausalLM, pipeline

# Use GPU if available.
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Disable flex attention and set a dedicated cache directory.
os.environ["TRANSFORMERS_NO_FLEX_ATTENTION"] = "1"
CACHE_DIR = "/tmp/transformers_cache"
os.environ["TRANSFORMERS_CACHE"] = CACHE_DIR

# For static extraction of key symptom via keyword matching.
def static_extract_key_symptom(transcript: str) -> str:
    symptoms = {
        "fever": ["fever", "temperature", "hot"],
        "coughing": ["cough", "coughing"],
        "headache": ["headache", "head pain"],
        "back pain": ["back pain", "lower back", "upper back"],
        "toothache": ["toothache", "dental pain", "tooth pain"]
    }
    transcript_lower = transcript.lower()
    for symptom, keywords in symptoms.items():
        for keyword in keywords:
            if keyword in transcript_lower:
                return symptom
    return transcript  # Fallback if no keyword is found

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = Flask(__name__)
CORS(app)

# Set your ngrok auth token.
NGROK_AUTH_TOKEN = "2sZL5k5FBMPppi3zC5xRRYuG5IP_6BiBZ5A9ee77WTxAfVWqa"
ngrok.set_auth_token(NGROK_AUTH_TOKEN)

# For guideline generation using LLM.
class LLMHandler:
    """Handles interactions with the LLM for generating guidelines."""
    def __init__(self):
        self.tokenizer = None
        self.model = None
        self.pipeline = None

    def clear_model_cache(self):
        if os.path.exists(CACHE_DIR):
            shutil.rmtree(CACHE_DIR)
            os.makedirs(CACHE_DIR, exist_ok=True)
            logger.info(f"Cleared Transformers cache at {CACHE_DIR}")

    def load_model(self):
        if self.pipeline is None:
            try:
                logger.info("Clearing model cache before loading LLM for guidelines...")
                self.clear_model_cache()
                logger.info("Loading LLM model for guidelines...")
                HUGGING_FACE_TOKEN = os.getenv("HUGGING_FACE_TOKEN", "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")
                LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME", "ContactDoctor/Bio-Medical-Llama-3-2-1B-CoT-012025")
                self.tokenizer = AutoTokenizer.from_pretrained(
                    LLM_MODEL_NAME,
                    use_auth_token=HUGGING_FACE_TOKEN,
                    force_download=True,
                    use_fast=False,              # Force slow tokenizer
                    trust_remote_code=True,
                    cache_dir=CACHE_DIR
                )
                self.model = AutoModelForCausalLM.from_pretrained(
                    LLM_MODEL_NAME,
                    use_auth_token=HUGGING_FACE_TOKEN,
                    torch_dtype=torch.float16 if DEVICE == "cuda" else torch.float32,
                    force_download=True,
                    trust_remote_code=True,
                    cache_dir=CACHE_DIR
                )
                self.pipeline = pipeline(
                    "text-generation",
                    model=self.model,
                    tokenizer=self.tokenizer,
                    device=0 if DEVICE == "cuda" else -1
                )
                logger.info("LLM model loaded successfully for guidelines.")
            except Exception as e:
                logger.error("Error loading LLM model", exc_info=True)
                raise e

    def generate_text(self, prompt, max_new_tokens, num_beams, temperature, repetition_penalty, early_stopping=True) -> str:
        if self.pipeline is None:
            self.load_model()
        try:
            logger.info("Generating text from LLM for guidelines...")
            pipeline_output = self.pipeline(
                prompt,
                max_new_tokens=max_new_tokens,
                num_beams=num_beams,
                early_stopping=early_stopping,
                temperature=temperature,
                repetition_penalty=repetition_penalty
            ) or []
            result = list(pipeline_output)
            if result and isinstance(result[0], dict):
                generated_text = result[0].get('generated_text', "")
            else:
                generated_text = str(result[0]) if result else ""
            return generated_text if generated_text is not None else ""
        except Exception as e:
            logger.error("LLM generation error", exc_info=True)
            return ""

    def generate_guidelines(self, transcript: str, key_symptom: str, follow_up: list) -> str:
        follow_up_text = "\n".join(
            [f"Q: {item['question']}\nA: {item['answer']}" for item in follow_up]
        )
        prompt = (
            "You are a caring doctor. Based on the following patient description, key symptom, and follow-up responses, provide three concise home care guidelines for the patient.\n"
            f"Patient Description: {transcript}\n"
            f"Key Symptom: {key_symptom}\n"
            f"Follow-Up Responses:\n{follow_up_text}\n"
            "Provide exactly three guidelines, each starting with '- '."
        )
        return self.generate_text(prompt, max_new_tokens=300, num_beams=5, temperature=0.7, repetition_penalty=1.2)

llm_handler = LLMHandler()

@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded. Please upload an audio file with key 'file'."}), 400

    audio_file = request.files["file"]
    with tempfile.NamedTemporaryFile(suffix=".wav") as temp_audio:
        audio_file.save(temp_audio.name)
        try:
            model = whisper.load_model("tiny", device=DEVICE)
        except Exception as e:
            logger.error("Whisper model load failed", exc_info=True)
            return jsonify({"error": f"Model load failed: {str(e)}"}), 500

        try:
            result = model.transcribe(temp_audio.name)
            logger.info(f"Raw transcription result: {result}")
        except Exception as e:
            logger.error("Transcription failed", exc_info=True)
            return jsonify({"error": f"Transcription failed: {str(e)}"}), 500

        transcript_raw = result.get("text", "")
        transcript = transcript_raw.strip() if not isinstance(transcript_raw, list) else " ".join(transcript_raw).strip()
        logger.info(f"Transcript generated: '{transcript}'")
        if not transcript:
            return jsonify({"error": "No transcript was generated. Please ensure the audio is clear and ffmpeg is installed."}), 500

        del model
        gc.collect()

    return jsonify({"transcript": transcript})

@app.route("/extract_symptoms", methods=["POST"])
def extract_symptoms():
    data = request.get_json()
    if not data or "transcript" not in data:
        return jsonify({"error": "No transcript provided. Please provide a transcript in the request body."}), 400

    transcript = data["transcript"].strip()
    if not transcript:
        return jsonify({"error": "The provided transcript is empty."}), 400

    try:
        key_symptom = static_extract_key_symptom(transcript)
    except Exception as e:
        logger.error("Static extraction error", exc_info=True)
        return jsonify({"error": f"Static extraction error: {str(e)}"}), 500

    logger.info(f"Extracted key symptom (internal): '{key_symptom}'")
    # Return key symptom internally; frontend will not display it.
    return jsonify({"key_symptom": key_symptom})

@app.route("/generate_guidelines", methods=["POST"])
def generate_guidelines():
    data = request.get_json()
    if not data or not all(k in data for k in ["transcript", "key_symptom", "follow_up"]):
        return jsonify({"error": "Missing required fields. Please provide transcript, key_symptom, and follow_up."}), 400

    transcript = data["transcript"].strip()
    key_symptom = data["key_symptom"].strip()
    follow_up = data["follow_up"]  # Expect a list of objects with 'question' and 'answer'
    for item in follow_up:
        if not item.get("answer", "").strip():
            return jsonify({"error": "All follow-up questions must be answered."}), 400

    try:
        llm_handler.load_model()
        guidelines_text = llm_handler.generate_guidelines(transcript, key_symptom, follow_up)
    except Exception as e:
        logger.error("Guideline generation error", exc_info=True)
        return jsonify({"error": f"Guideline generation error: {str(e)}"}), 500

    logger.info(f"Generated guidelines: '{guidelines_text}'")
    return jsonify({"guidelines": guidelines_text})

if __name__ == "__main__":
    try:
        public_url = ngrok.connect("5000")
        print("Public URL:", public_url)
    except Exception as ngrok_error:
        print("Ngrok error:", ngrok_error)
    app.run(host="0.0.0.0", port=5000)