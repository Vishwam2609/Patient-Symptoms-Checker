# --- Begin Monkey Patches (must be at the very top) ---
import transformers
import torch

if not hasattr(torch, "compiler"):
    class DummyCompiler:
        @staticmethod
        def disable(recursive=False):
            def decorator(func):
                return func
            return decorator
    torch.compiler = DummyCompiler()

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
import re
import base64
import io
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from pyngrok import ngrok
import whisper
from transformers import AutoTokenizer, AutoModelForCausalLM, pipeline
from gtts import gTTS
import torch

# Use GPU if available.
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Disable flex attention and set a dedicated cache directory.
os.environ["TRANSFORMERS_NO_FLEX_ATTENTION"] = "1"
CACHE_DIR = "/tmp/transformers_cache"
os.environ["TRANSFORMERS_CACHE"] = CACHE_DIR

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = Flask(__name__)
CORS(app)

NGROK_AUTH_TOKEN = "2sZL5k5FBMPppi3zC5xRRYuG5IP_6BiBZ5A9ee77WTxAfVWqa"
ngrok.set_auth_token(NGROK_AUTH_TOKEN)

# LLMHandler for key symptom extraction and guideline generation.
class LLMHandler:
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
                logger.info("Clearing model cache before loading LLM...")
                self.clear_model_cache()
                logger.info("Loading LLM model...")
                HUGGING_FACE_TOKEN = os.getenv("HUGGING_FACE_TOKEN", "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")
                LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME", "ContactDoctor/Bio-Medical-Llama-3-2-1B-CoT-012025")
                self.tokenizer = AutoTokenizer.from_pretrained(
                    LLM_MODEL_NAME,
                    use_auth_token=HUGGING_FACE_TOKEN,
                    force_download=True,
                    use_fast=False,
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
                logger.info("LLM model loaded successfully.")
            except Exception as e:
                logger.error("Error loading LLM model", exc_info=True)
                raise e

    def generate_text(self, prompt, max_new_tokens, num_beams, temperature, repetition_penalty, early_stopping=True) -> str:
        if self.pipeline is None:
            self.load_model()
        if self.pipeline is None:
            logger.error("LLM pipeline is not available after loading.")
            return ""
        try:
            logger.info("Generating text from LLM...")
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
            return generated_text.strip() if generated_text is not None else ""
        except Exception as e:
            logger.error("LLM generation error", exc_info=True)
            return ""

    def generate_guidelines(self, transcript: str, key_symptom: str, follow_up: list) -> str:
        """
        Generates a Personalized Home Care Plan using the full conversation context.
        It considers the patient's description, key symptom, and follow-up Q&A,
        and returns a complete, clear set of home care guidelines.
        """
        follow_up_text = "\n".join(
            [f"Q: {item['question']}\nA: {item['answer']}" for item in follow_up]
        )
        detailed_context = (
            "Conversation so far:\n"
            f"Patient's description: {transcript}\n"
            f"Key symptom: {key_symptom}\n"
            f"Follow-up Q&A:\n{follow_up_text}\n"
        )

        prompt = (
            "You are a caring doctor speaking directly to a patient with limited medical knowledge. "
            "Based on the conversation below, please provide a Personalized Home Care Plan. "
            "Ensure that your advice is clear, actionable, and written in plain language so that the patient can easily follow it at home. "
            "Respond in one complete and concise paragraph, as if you are continuing your conversation with the patient.\n\n"
            f"{detailed_context}\n\n"
            "Your Personalized Home Care Plan:"
        )

        for _ in range(10):
            result = self.generate_text(
                prompt,
                max_new_tokens=300,
                num_beams=5,
                temperature=0.5,
                repetition_penalty=1.0,
                early_stopping=True
            )
            if "Your Personalized Home Care Plan:" in result:
                result = result.split("Your Personalized Home Care Plan:")[-1].strip()
            paragraph = " ".join(result.split())
            words = paragraph.split()
            if len(words) >= 30:
                if paragraph[-1] not in ".!?":
                    paragraph += "."
                return paragraph

        return "No valid guidelines generated."

llm_handler = LLMHandler()

import re

@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded. Please upload an audio file with key 'file'."}), 400

    audio_file = request.files["file"]
    with tempfile.NamedTemporaryFile(suffix=".wav") as temp_audio:
        audio_file.save(temp_audio.name)
        try:
            # Use the English-only model for improved accuracy.
            model = whisper.load_model("small.en", device=DEVICE)
        except Exception as e:
            logger.error("Whisper model load failed", exc_info=True)
            return jsonify({"error": f"Model load failed: {str(e)}"}), 500

        try:
            # Use fp16=False for stability if needed.
            result = model.transcribe(temp_audio.name, fp16=False)
            logger.info(f"Raw transcription result: {result}")
        except Exception as e:
            logger.error("Transcription failed", exc_info=True)
            return jsonify({"error": f"Transcription failed: {str(e)}"}), 500

        transcript_raw = result.get("text", "")
        transcript = (transcript_raw.strip() 
                      if not isinstance(transcript_raw, list) 
                      else " ".join(transcript_raw).strip())

        # Enhance the transcript: collapse multiple spaces and remove unusual characters.
        transcript = re.sub(r'\s+', ' ', transcript)         # Collapse multiple spaces.
        transcript = re.sub(r'[^\w\s.,!?]', '', transcript)    # Remove non-standard characters.

        logger.info(f"Processed transcript: '{transcript}'")
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
        key_symptom = llm_handler.generate_text(
            "You are a caring doctor. Based on the following patient description, extract the key symptom in one short word or phrase.\n\n"
            f"Patient Description: {transcript}\n\n"
            "Answer:", 
            max_new_tokens=20, num_beams=3, temperature=0.7, repetition_penalty=1.2
        )
        if "Answer:" in key_symptom:
            key_symptom = key_symptom.split("Answer:")[-1].strip()
    except Exception as e:
        logger.error("Key symptom extraction error", exc_info=True)
        return jsonify({"error": f"Key symptom extraction error: {str(e)}"}), 500

    logger.info(f"Extracted key symptom (internal): '{key_symptom}'")
    return jsonify({"key_symptom": key_symptom})

@app.route("/generate_guidelines", methods=["POST"])
def generate_guidelines():
    data = request.get_json()
    if not data or not all(k in data for k in ["transcript", "key_symptom", "follow_up"]):
        return jsonify({"error": "Missing required fields. Please provide transcript, key_symptom, and follow_up."}), 400

    transcript = data["transcript"].strip()
    key_symptom = data["key_symptom"].strip()
    follow_up = data["follow_up"]
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
    
    # Convert the guidelines text to speech using gTTS.
    try:
        tts = gTTS(text=guidelines_text, lang='en')
        audio_io = io.BytesIO()
        tts.write_to_fp(audio_io)
        audio_io.seek(0)
        audio_base64 = base64.b64encode(audio_io.read()).decode('utf-8')
        audio_data_url = f"data:audio/mp3;base64,{audio_base64}"
    except Exception as e:
        logger.error("TTS conversion error", exc_info=True)
        audio_data_url = ""

    return jsonify({"guidelines": guidelines_text, "audio": audio_data_url})

if __name__ == "__main__":
    try:
        public_url = ngrok.connect("5000")
        print("Public URL:", public_url)
    except Exception as ngrok_error:
        print("Ngrok error:", ngrok_error)
    app.run(host="0.0.0.0", port=5000)