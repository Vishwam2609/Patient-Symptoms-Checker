import os
import logging
import gc
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS
from pyngrok import ngrok
import torch
import whisper

# For static extraction, we define a simple function to look for keywords.
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
    return transcript  # Fallback

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = Flask(__name__)
CORS(app)

NGROK_AUTH_TOKEN = "2sZL5k5FBMPppi3zC5xRRYuG5IP_6BiBZ5A9ee77WTxAfVWqa"
ngrok.set_auth_token(NGROK_AUTH_TOKEN)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

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
            logger.error("Model load failed", exc_info=True)
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
    # Do not return the key symptom to the frontend.
    return jsonify({"key_symptom": key_symptom})
    
if __name__ == "__main__":
    try:
        public_url = ngrok.connect("5000")
        print("Public URL:", public_url)
    except Exception as ngrok_error:
        print("Ngrok error:", ngrok_error)
    app.run(host="0.0.0.0", port=5000)