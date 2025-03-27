# File: src/server.py
import os
import logging
import gc
import tempfile
import requests
from flask import Flask, request, jsonify
from pyngrok import ngrok
import torch
import whisper
from transformers import AutoTokenizer, AutoModelForCausalLM, pipeline

# Monkey-patch torch.compiler if necessary (for PyTorch versions that don't have it)
if not hasattr(torch, "compiler"):
    class DummyCompiler:
        @staticmethod
        def disable(recursive=False):
            def decorator(func):
                return func
            return decorator
    torch.compiler = DummyCompiler()  # type: ignore[attr-defined]

# Disable flex attention to avoid related errors
os.environ["TRANSFORMERS_NO_FLEX_ATTENTION"] = "1"

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Set ngrok auth token
NGROK_AUTH_TOKEN = "2sZL5k5FBMPppi3zC5xRRYuG5IP_6BiBZ5A9ee77WTxAfVWqa"
ngrok.set_auth_token(NGROK_AUTH_TOKEN)

app = Flask(__name__)

# Global LLM settings
LLM_MODEL_NAME = "ContactDoctor/Bio-Medical-Llama-3-2-1B-CoT-012025"
HUGGING_FACE_TOKEN = "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"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

class LLMHandler:
    """Handles interactions with the LLM for generating guidance."""
    def __init__(self):
        self.tokenizer = None
        self.model = None
        self.pipeline = None

    def load_model(self):
        if self.pipeline is None:
            try:
                logger.info("Loading LLM model...")
                self.tokenizer = AutoTokenizer.from_pretrained(
                    LLM_MODEL_NAME, token=HUGGING_FACE_TOKEN, force_download=True, revision="main"
                )
                self.model = AutoModelForCausalLM.from_pretrained(
                    LLM_MODEL_NAME,
                    token=HUGGING_FACE_TOKEN,
                    torch_dtype=torch.float16 if DEVICE == "cuda" else torch.float32,
                    force_download=True,
                    revision="main"
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
            raise Exception("LLM pipeline is not loaded, cannot generate text.")
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
            generated_text = str(generated_text) if generated_text is not None else ""
            logger.info("Text generation complete.")
            return generated_text
        except Exception as e:
            logger.error("LLM generation error", exc_info=True)
            return ""

    def extract_key_symptom(self, text: str) -> str:
        prompt = (
            "Based on the patient information below, extract the main symptom described by the patient. "
            "Provide your answer as one clear, concise sentence without extra commentary.\n"
            f"{text}\n\nAnswer:\n"
        )
        extraction = self.generate_text(prompt, 50, 3, 0.7, 1.2)
        extraction = str(extraction)
        if "Answer:" in extraction:
            extraction = extraction.split("Answer:", 1)[1].strip()
        return extraction

llm_handler = LLMHandler()

# Endpoint: Transcribe audio using Whisper
@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded. Please upload an audio file with key 'file'."}), 400

    audio_file = request.files["file"]
    with tempfile.NamedTemporaryFile(suffix=".wav") as temp_audio:
        audio_file.save(temp_audio.name)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        try:
            model = whisper.load_model("tiny", device=device)
        except Exception as e:
            logger.error("Model load failed", exc_info=True)
            return jsonify({"error": f"Model load failed: {str(e)}"}), 500

        try:
            result = model.transcribe(temp_audio.name)
            logger.info(f"Raw transcription result: {result}")
        except Exception as e:
            logger.error("Transcription failed", exc_info=True)
            return jsonify({"error": f"Transcription failed: {str(e)}"}), 500

        transcript_raw = result.get("text", "")
        if isinstance(transcript_raw, list):
            transcript = " ".join(transcript_raw).strip()
        else:
            transcript = transcript_raw.strip()

        logger.info(f"Transcript generated: '{transcript}'")
        if not transcript:
            return jsonify({"error": "No transcript was generated. Please ensure the audio is clear and ffmpeg is installed."}), 500

        del model
        gc.collect()

    return jsonify({"transcript": transcript})

# Endpoint: Extract key symptoms from the provided transcript (editable)
@app.route("/extract_symptoms", methods=["POST"])
def extract_symptoms():
    data = request.get_json()
    if not data or "transcript" not in data:
        return jsonify({"error": "No transcript provided. Please provide a transcript in the request body."}), 400

    transcript = data["transcript"].strip()
    if not transcript:
        return jsonify({"error": "The provided transcript is empty."}), 400

    try:
        key_symptom = llm_handler.extract_key_symptom(transcript)
    except Exception as e:
        logger.error("LLM extraction error", exc_info=True)
        return jsonify({"error": f"LLM extraction error: {str(e)}"}), 500

    return jsonify({"key_symptom": key_symptom})

if __name__ == "__main__":
    try:
        public_url = ngrok.connect("5000")
        print("Public URL:", public_url)
    except Exception as ngrok_error:
        print("Ngrok error:", ngrok_error)
    app.run(host="0.0.0.0", port=5000)