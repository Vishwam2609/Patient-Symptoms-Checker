import React, { useState } from 'react';
import { AudioRecorder } from './components/AudioRecorder';
import { Button } from './components/ui/button';
import { Mic, MessageSquare } from 'lucide-react';

// Helper function to send the recorded audio to the backend for key symptom extraction.
async function extractSymptoms(blob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', blob, 'recording.wav');

  // Replace the URL below with your actual ngrok HTTPS URL.
  const response = await fetch('https://abcd1234.ngrok.io/extract_symptoms', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Extraction failed');
  }
  const data = await response.json();
  return data.key_symptoms;
}

function App() {
  // App steps: 'initial' -> 'recording' -> 'review' -> 'followup' -> 'completed'
  const [step, setStep] = useState<'initial' | 'recording' | 'review' | 'followup' | 'completed'>('initial');

  // State for the initial recording and extracted key symptoms.
  const [initialRecording, setInitialRecording] = useState<Blob | null>(null);
  const [keySymptoms, setKeySymptoms] = useState<string | null>(null);
  const [loadingExtraction, setLoadingExtraction] = useState(false);

  // Follow-up questions and state.
  const followUpQuestions = [
    "When did you first notice these symptoms, and have they been constant or intermittent?",
    "Have you experienced any additional symptoms or changes in your overall health along with this?",
    "Have there been any recent events, exposures, or activities that might be linked to the onset of these symptoms?"
  ];
  const [followUpIndex, setFollowUpIndex] = useState(0);
  const [followUpRecordings, setFollowUpRecordings] = useState<Blob[]>([]);

  // Callback when initial recording is completed.
  const handleInitialRecordingComplete = async (audioBlob: Blob) => {
    setInitialRecording(audioBlob);
    setLoadingExtraction(true);
    try {
      // Send audio to backend via HTTP ngrok tunnel.
      const extracted = await extractSymptoms(audioBlob);
      setKeySymptoms(extracted);
    } catch (error) {
      console.error(error);
      setKeySymptoms("Extraction failed");
    }
    setLoadingExtraction(false);
    // Move to review step so the patient can see the extracted key symptoms.
    setStep('review');
  };

  // When the patient reviews the key symptoms and continues.
  const handleContinueAfterReview = () => {
    setStep('followup');
    setFollowUpIndex(0);
    setFollowUpRecordings([]);
  };

  // Callback when a follow-up recording is completed.
  const handleFollowUpRecordingComplete = (audioBlob: Blob) => {
    setFollowUpRecordings(prev => {
      const newRecordings = [...prev];
      newRecordings[followUpIndex] = audioBlob;
      return newRecordings;
    });
    const nextIndex = followUpIndex + 1;
    if (nextIndex < followUpQuestions.length) {
      setFollowUpIndex(nextIndex);
    } else {
      setStep('completed');
      // Optionally log the recordings for further processing.
      console.log("Initial recording:", initialRecording);
      console.log("Key symptoms:", keySymptoms);
      console.log("Follow-up recordings:", followUpRecordings);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Patient Symptom Guide</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Describe your symptoms using voice and receive personalized medical guidance.
            This tool helps you understand your symptoms but does not replace professional medical advice.
          </p>
        </header>

        <main className="bg-white rounded-lg shadow-lg p-8">
          {step === 'initial' && (
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                  <Mic className="w-8 h-8 text-blue-600" />
                </div>
              </div>
              <h2 className="text-2xl font-semibold text-gray-900">Start by describing your symptoms</h2>
              <p className="text-gray-600">
                Click the button below and speak clearly about what's bothering you.
                You can review and re-record if needed.
              </p>
              <Button
                onClick={() => setStep('recording')}
                className="flex items-center gap-2"
              >
                <Mic className="w-4 h-4" />
                Start Recording
              </Button>
            </div>
          )}

          {step === 'recording' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-semibold text-gray-900">Record Your Symptoms</h2>
              <p className="text-gray-600">
                Please speak clearly about your symptoms. When you stop recording, you’ll see options to play, re-record, or proceed.
              </p>
              <AudioRecorder onRecordingComplete={handleInitialRecordingComplete} />
              {loadingExtraction && (
                <p className="mt-4 text-center text-gray-600">Extracting key symptoms...</p>
              )}
            </div>
          )}

          {step === 'review' && (
            <div className="text-center space-y-6">
              <h2 className="text-2xl font-semibold text-gray-900">Review Extracted Key Symptoms</h2>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-gray-900 font-medium">{keySymptoms}</p>
              </div>
              <Button
                onClick={handleContinueAfterReview}
                className="mt-4 flex items-center gap-2"
              >
                Continue
              </Button>
            </div>
          )}

          {step === 'followup' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-semibold text-gray-900">
                Follow-up Question {followUpIndex + 1} of {followUpQuestions.length}
              </h2>
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-gray-900 font-medium">{followUpQuestions[followUpIndex]}</p>
                    <div className="mt-2">
                      {/* New instance of AudioRecorder for each follow-up */}
                      <AudioRecorder
                        key={followUpIndex}
                        onRecordingComplete={handleFollowUpRecordingComplete}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'completed' && (
            <div className="text-center space-y-6">
              <h2 className="text-2xl font-semibold text-gray-900">Thank You!</h2>
              <p className="text-gray-600">
                We have received all your responses. A medical professional will review them shortly.
              </p>
            </div>
          )}
        </main>

        <footer className="mt-8 text-center text-sm text-gray-500">
          <p>
            This is an informational tool only. If you're experiencing severe symptoms,
            please seek immediate medical attention.
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;