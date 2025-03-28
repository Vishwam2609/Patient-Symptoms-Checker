import React, { useState, useEffect } from 'react';
import { AudioRecorder } from './components/AudioRecorder';
import { Button } from './components/ui/button';
import { Mic } from 'lucide-react';

// Replace with your actual ngrok public URL from your backend.
const API_BASE_URL = 'https://8341-100-27-249-117.ngrok-free.app';

// Mapping from key symptom (in lowercase) to follow-up questions.
const followUpQuestionsMapping: { [key: string]: string[] } = {
  fever: [
    "When did you first notice your fever, and has your temperature been consistently high or fluctuating?",
    "Are you experiencing any other symptoms like chills, sweating, or body aches?",
    "Have you had any recent exposures—such as travel or contact with someone ill—that might explain your fever?"
  ],
  coughing: [
    "When did your cough start, and is it persistent or intermittent?",
    "Is your cough dry, or are you producing any phlegm? If so, what color is it?",
    "Do you have any other breathing difficulties, such as shortness of breath or chest tightness?"
  ],
  headache: [
    "When did your headache begin, and how would you describe its intensity and duration?",
    "Is the headache concentrated in one area or more generalized?",
    "Are you experiencing nausea, sensitivity to light or sound, or any visual disturbances?"
  ],
  "back pain": [
    "When did your back pain start, and is it in a specific area (e.g., lower back)?",
    "Does the pain get worse with movement or remain constant?",
    "Have you done any strenuous activities recently that might have strained your back?"
  ],
  toothache: [
    "When did your toothache begin, and is the pain constant or does it come and go?",
    "How would you describe the pain, and does it spread to nearby areas?",
    "Have you noticed any other dental issues like gum swelling or increased sensitivity?"
  ]
};

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
  return data.key_symptom; // Used internally only.
}

async function generateGuidelines(
  transcript: string,
  key_symptom: string,
  follow_up: { question: string; answer: string }[]
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/generate_guidelines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, key_symptom, follow_up }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Guideline generation failed');
  }
  const data = await response.json();
  return data.guidelines;
}

function App() {
  const [step, setStep] = useState<'initial' | 'recording' | 'review' | 'followup' | 'final'>('initial');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [editedTranscript, setEditedTranscript] = useState<string>('');
  const [extractedSymptom, setExtractedSymptom] = useState<string>(''); // Internal only
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [followUpAnswers, setFollowUpAnswers] = useState<string[]>([]);
  const [guidelines, setGuidelines] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Recording complete: get transcript.
  const handleRecordingComplete = async (blob: Blob) => {
    setRecordedBlob(blob);
    setLoading(true);
    try {
      const transcribedText = await transcribeAudio(blob);
      setTranscript(transcribedText);
      setEditedTranscript(transcribedText);
      setStep('review');
    } catch (error: any) {
      console.error("Transcription error:", error);
      alert("We couldn't understand your recording. Please try again.");
    }
    setLoading(false);
  };

  // After reviewing, extract key symptom internally and set follow-up questions.
  const handleExtractSymptoms = async () => {
    if (!editedTranscript) return;
    setLoading(true);
    try {
      const symptom = await extractSymptoms(editedTranscript);
      setExtractedSymptom(symptom);
      // Lookup follow-up questions based on the extracted symptom.
      const symptomLower = symptom.toLowerCase();
      let questions: string[] = [];
      for (const key in followUpQuestionsMapping) {
        if (symptomLower.includes(key)) {
          questions = followUpQuestionsMapping[key];
          break;
        }
      }
      setFollowUpQuestions(questions);
      setCurrentQuestionIndex(0);
      setFollowUpAnswers([]);
      setStep('followup');
    } catch (error: any) {
      console.error("Symptom extraction error:", error);
      alert("We had trouble understanding your symptoms. Please try again.");
    }
    setLoading(false);
  };

  // For each follow-up question, ensure an answer is provided before moving on.
  const handleNextFollowUp = () => {
    const answer = followUpAnswers[currentQuestionIndex] || "";
    if (!answer.trim()) {
      alert("Please share your answer before proceeding.");
      return;
    }
    if (currentQuestionIndex + 1 < followUpQuestions.length) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      setStep('final');
    }
  };

  // When final step is reached, generate guidelines.
  useEffect(() => {
    if (step === "final") {
      const generate = async () => {
        setLoading(true);
        try {
          const followUpData = followUpQuestions.map((q, i) => ({
            question: q,
            answer: followUpAnswers[i] || ""
          }));
          const guidelinesResult = await generateGuidelines(editedTranscript, extractedSymptom, followUpData);
          setGuidelines(guidelinesResult);
        } catch (error: any) {
          console.error("Guideline generation error:", error);
          alert("We couldn't generate your care guidelines. Please try again.");
        }
        setLoading(false);
      };
      generate();
    }
  }, [step, editedTranscript, extractedSymptom, followUpQuestions, followUpAnswers]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-gray-100 py-8">
      <div className="max-w-3xl w-full p-6 bg-white rounded-xl shadow-lg">
        {/* Steps */}
        {step === 'initial' && (
          <div className="space-y-6 text-center">
            <div className="flex justify-center">
              <div className="flex items-center justify-center w-20 h-20 bg-blue-200 rounded-full shadow-lg">
                <Mic className="w-10 h-10 text-blue-600" />
              </div>
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900">Welcome, Dear Patient</h1>
            <p className="text-lg text-gray-700">
              We’re here to help you feel your best. Share your symptoms, and we’ll guide you toward simple, caring home advice.
            </p>
            <Button
              onClick={() => setStep('recording')}
              className="px-6 py-3 mt-4 text-white bg-blue-600 rounded-lg shadow hover:bg-blue-700"
            >
              <Mic className="w-5 h-5 mr-2" /> Start Recording
            </Button>
          </div>
        )}

        {step === 'recording' && (
          <div className="space-y-6 text-center">
            <h2 className="text-3xl font-semibold text-gray-900">Tell Us How You Feel</h2>
            <AudioRecorder onRecordingComplete={handleRecordingComplete} />
            {loading && <p className="mt-4 text-gray-600">Listening...</p>}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-gray-900">Review Your Message</h2>
            <p className="text-gray-700">
              Please confirm or adjust the text so we understand you perfectly.
            </p>
            <textarea
              className="w-full p-3 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              rows={6}
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
            />
            <Button
              onClick={handleExtractSymptoms}
              disabled={loading}
              className="px-6 py-3 mt-4 text-white bg-green-600 rounded-lg shadow hover:bg-green-700"
            >
              Proceed to Follow-Up
            </Button>
          </div>
        )}

        {step === 'followup' && followUpQuestions.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              Follow-Up ({currentQuestionIndex + 1} of {followUpQuestions.length})
            </h2>
            <p className="text-lg text-gray-700">{followUpQuestions[currentQuestionIndex]}</p>
            <textarea
              className="w-full p-3 mt-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              rows={3}
              placeholder="Type your answer here..."
              value={followUpAnswers[currentQuestionIndex] || ""}
              onChange={(e) => {
                const newAnswers = [...followUpAnswers];
                newAnswers[currentQuestionIndex] = e.target.value;
                setFollowUpAnswers(newAnswers);
              }}
            />
            <Button
              onClick={handleNextFollowUp}
              className="px-6 py-3 mt-4 text-white bg-purple-600 rounded-lg shadow hover:bg-purple-700"
            >
              Next
            </Button>
          </div>
        )}

        {step === 'final' && (
          <div className="space-y-6 text-center">
            <h2 className="text-3xl font-bold text-gray-900">Your Personalized Home Care Plan</h2>
            {loading ? (
              <p className="text-lg text-gray-600">Generating your care plan...</p>
            ) : (
              <div className="p-4 bg-gray-50 rounded-md shadow">
                <pre className="text-lg text-gray-800 whitespace-pre-wrap">{guidelines}</pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subtle footer message */}
      <footer className="mt-4 text-sm text-center text-gray-500">
        We care about you. Your well-being is our highest priority.
      </footer>
    </div>
  );
}

export default App;