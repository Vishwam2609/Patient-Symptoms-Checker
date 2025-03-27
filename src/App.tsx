// File: src/App.tsx
import React, { useState } from 'react';
import { AudioRecorder } from './components/AudioRecorder';
import { Button } from './components/ui/button';
import { Mic, MessageSquare } from 'lucide-react';

// Replace with your actual ngrok public URL provided by your backend
const API_BASE_URL = 'https://<your-ngrok-url>';

async function transcribeAudio(blob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', blob, 'recording.wav');

  const response = await fetch(`${API_BASE_URL}/transcribe`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Transcription failed');
  }
  const data = await response.json();
  return data.transcript;
}

async function extractSymptoms(transcript: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/extract_symptoms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Symptom extraction failed');
  }
  const data = await response.json();
  return data.key_symptom;
}

function App() {
  // App steps: 'initial' -> 'recording' -> 'review' -> 'followup'
  const [step, setStep] = useState<'initial' | 'recording' | 'review' | 'followup'>('initial');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [editedTranscript, setEditedTranscript] = useState<string>('');
  const [keySymptoms, setKeySymptoms] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRecordingComplete = async (blob: Blob) => {
    setRecordedBlob(blob);
    setLoading(true);
    try {
      const transcribedText = await transcribeAudio(blob);
      setTranscript(transcribedText);
      setEditedTranscript(transcribedText);
      setStep('review');
    } catch (error: any) {
      console.error(error);
      alert("Transcription failed. Please try again.");
    }
    setLoading(false);
  };

  const handleExtractSymptoms = async () => {
    if (!editedTranscript) return;
    setLoading(true);
    try {
      const extracted = await extractSymptoms(editedTranscript);
      setKeySymptoms(extracted);
      setStep('followup');
    } catch (error: any) {
      console.error(error);
      alert("Symptom extraction failed. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        {/* Initial page with mic icon remains unchanged */}
        {step === 'initial' && (
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                <Mic className="w-8 h-8 text-blue-600" />
              </div>
            </div>
            <h1 className="text-4xl font-bold text-gray-900">Patient Symptom Guide</h1>
            <p className="text-lg text-gray-600">
              Describe your symptoms using your voice and receive personalized guidance.
            </p>
            <Button onClick={() => setStep('recording')} className="flex items-center gap-2">
              <Mic className="w-4 h-4" /> Start Recording
            </Button>
          </div>
        )}

        {step === 'recording' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-gray-900">Record Your Symptoms</h2>
            <AudioRecorder onRecordingComplete={handleRecordingComplete} />
            {loading && <p className="mt-4 text-center text-gray-600">Transcribing...</p>}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-gray-900">Review Your Transcription</h2>
            <textarea
              className="w-full border p-2 rounded-md"
              rows={6}
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
            />
            <Button onClick={handleExtractSymptoms} disabled={loading} className="mt-4 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Extract Key Symptoms
            </Button>
          </div>
        )}

        {step === 'followup' && (
          <div className="space-y-6 text-center">
            <h2 className="text-2xl font-semibold text-gray-900">Extracted Key Symptoms</h2>
            <p className="text-lg">{keySymptoms}</p>
          </div>
        )}
      </div>
      <footer className="mt-8 text-center text-sm text-gray-500">
        <p>This tool is informational only. Please seek professional advice for medical concerns.</p>
      </footer>
    </div>
  );
}

export default App;