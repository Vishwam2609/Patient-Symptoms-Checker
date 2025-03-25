from flask import Flask, request, jsonify
import whisper
import tempfile
import requests
import gc
# import os
from pyngrok import ngrok

# Set your Ngrok auth token
NGROK_AUTH_TOKEN = "2sZL5k5FBMPppi3zC5xRRYuG5IP_6BiBZ5A9ee77WTxAfVWqa"
ngrok.set_auth_token(NGROK_AUTH_TOKEN)

app = Flask(__name__)

# Hugging Face model settings
HF_MODEL = "ContactDoctor/Bio-Medical-Llama-3-2-1B-CoT-012025"
HF_API_URL = f"https://api-inference.huggingface.co/models/{HF_MODEL}"
# HF_TOKEN = "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"
HUGGINGFACE_TOKEN = os.getenv("HUGGINGFACE_TOKEN")  # Instead of hardcoding the token

def query_huggingface_api(prompt: str) -> str:
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}
    payload = {"inputs": prompt}
    response = requests.post(HF_API_URL, headers=headers, json=payload)
    if response.status_code != 200:
        raise Exception(f"Hugging Face API error: {response.status_code} {response.text}")
    result = response.json()
    if isinstance(result, list) and result and "generated_text" in result[0]:
        return result[0]["generated_text"]
    elif isinstance(result, dict) and "generated_text" in result:
        return result["generated_text"]
    else:
        return str(result)

@app.route("/extract_symptoms", methods=["POST"])
def extract_symptoms():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded. Please upload an audio file with key 'file'."}), 400

    audio_file = request.files["file"]

    with tempfile.NamedTemporaryFile(suffix=".wav") as temp_audio:
        audio_file.save(temp_audio.name)
        # Load the Whisper tiny model on each request
        try:
            model = whisper.load_model("tiny", device="cpu")
        except Exception as e:
            return jsonify({"error": f"Model load failed: {str(e)}"}), 500

        result = model.transcribe(temp_audio.name)
        transcript_raw = result.get("text", "")
        if isinstance(transcript_raw, list):
            transcript = " ".join(transcript_raw).strip()
        else:
            transcript = transcript_raw.strip()
        # Unload the model and free memory.
        del model
        gc.collect()

    try:
        key_symptoms = query_huggingface_api(transcript)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"key_symptoms": key_symptoms})

if __name__ == "__main__":
    # Start an ngrok tunnel on port 5000
    public_url = ngrok.connect("5000")
    print("Public URL:", public_url)
    # Run the Flask app so it listens on all interfaces
    app.run(host="0.0.0.0", port=5000)