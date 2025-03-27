import React, { useState, useEffect } from 'react';
import { AudioRecorder } from './components/AudioRecorder';
import { Button } from './components/ui/button';
import { Mic, MessageSquare } from 'lucide-react';

// Replace with your actual ngrok public URL printed by your backend.
const API_BASE_URL = 'https://083a-3-141-107-28.ngrok-free.app';

// Mapping from key symptom (in lowercase) to follow-up questions
const followUpQuestionsMapping: { [key: string]: string[] } = {
  fever: [
    "When did you first notice your fever, and has the temperature been consistently high or fluctuating?",
    "Are you experiencing any other symptoms alongside the fever, such as chills, sweating, or body aches?",
    "Have you had any recent exposures—like travel, contact with someone ill, or changes in your daily environment—that might be contributing to your fever?"
  ],
  coughing: [
    "When did your cough start, and is it persistent or does it come and go?",
    "Is your cough dry, or are you producing any phlegm? If there is phlegm, what color is it?",
    "Are you experiencing any additional respiratory symptoms, such as shortness of breath, wheezing, or chest tightness?"
  ],
  headache: [
    "When did your headache begin, and how would you describe its intensity and duration?",
    "Is the headache localized to one area (e.g., one side of the head) or is it more generalized?",
    "Have you experienced other symptoms like nausea, sensitivity to light or sound, or visual disturbances alongside the headache?"
  ],
  "back pain": [
    "When did your back pain start, and can you specify if it’s localized to a particular area (e.g., lower back, upper back)?",
    "Does the pain worsen with certain movements or activities, or does it occur even at rest?",
    "Have you recently engaged in activities (like heavy lifting or prolonged sitting) or experienced any injuries that might be contributing to the pain?"
  ],
  toothache: [
    "When did you first notice your toothache, and is the pain constant or does it occur mainly during activities like chewing?",
    "How would you describe the pain—is it sharp, throbbing, or dull—and does it radiate to your jaw or ear?",
    "Have you experienced any additional dental issues, such as gum swelling, sensitivity to hot or cold foods, or a history of dental problems?"
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
  return data.key_symptom; // Note: This is used internally only.
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
  // Steps: initial → recording → review → followup → final
  const [step, setStep] = useState<'initial' | 'recording' | 'review' | 'followup' | 'final'>('initial');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [editedTranscript, setEditedTranscript] = useState<string>('');
  const [extractedSymptom, setExtractedSymptom] = useState<string>(''); // used internally
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [followUpAnswers, setFollowUpAnswers] = useState<string[]>([]);
  const [guidelines, setGuidelines] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // After recording, transcribe audio.
  const handleRecordingComplete = async (blob: Blob) => {
    setRecordedBlob(blob);
    setLoading(true);
    try {
      const transcribedText = await transcribeAudio(blob);
      setTranscript(transcribedText);
      setEditedTranscript(transcribedText);
      setStep('review');
    } catch (error: any) {
      console.error("Error in transcription:", error);
      alert("Transcription failed. Please try again.");
    }
    setLoading(false);
  };

  // When transcript is reviewed, extract key symptom internally and set up follow-up questions.
  const handleExtractSymptoms = async () => {
    if (!editedTranscript) return;
    setLoading(true);
    try {
      const symptom = await extractSymptoms(editedTranscript);
      setExtractedSymptom(symptom);
      // Determine follow-up questions from mapping.
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
      console.error("Error in symptom extraction:", error);
      alert("Symptom extraction failed. Please try again.");
    }
    setLoading(false);
  };

  // Handle follow-up question answer and ensure non-empty answer before proceeding.
  const handleNextFollowUp = () => {
    const answer = followUpAnswers[currentQuestionIndex] || "";
    if (!answer.trim()) {
      alert("Please answer the question before proceeding.");
      return;
    }
    if (currentQuestionIndex + 1 < followUpQuestions.length) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      setStep('final');
    }
  };

  // When final step is reached, generate guidelines using transcript, key symptom, and follow-up Q&A.
  useEffect(() => {
    if (step === "final") {
      const generate = async () => {
        setLoading(true);
        try {
          // Prepare follow-up Q&A as an array of objects.
          const followUp = followUpQuestions.map((q, i) => ({
            question: q,
            answer: followUpAnswers[i] || ""
          }));
          const guidelinesResult = await generateGuidelines(editedTranscript, extractedSymptom, followUp);
          setGuidelines(guidelinesResult);
        } catch (error: any) {
          console.error("Error in guideline generation:", error);
          alert("Guideline generation failed. Please try again.");
        }
        setLoading(false);
      };
      generate();
    }
  }, [step, editedTranscript, extractedSymptom, followUpQuestions, followUpAnswers]);

  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-50 to-gray-100">
      <div className="max-w-3xl mx-auto p-6">
        {step === 'initial' && (
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              <div className="w-20 h-20 bg-blue-200 rounded-full flex items-center justify-center shadow-lg">
                <Mic className="w-10 h-10 text-blue-600" />
              </div>
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900">Patient Symptom Guide</h1>
            <p className="text-lg text-gray-700">
              Record your symptoms to receive personalized follow-up questions.
            </p>
            <Button onClick={() => setStep('recording')} className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700">
              <Mic className="w-5 h-5 mr-2" /> Start Recording
            </Button>
          </div>
        )}

        {step === 'recording' && (
          <div className="space-y-6 text-center">
            <h2 className="text-3xl font-semibold text-gray-900">Record Your Symptoms</h2>
            <AudioRecorder onRecordingComplete={handleRecordingComplete} />
            {loading && <p className="mt-4 text-gray-600">Transcribing...</p>}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-gray-900">Review Your Transcription</h2>
            <p className="text-gray-700">Please review and edit the transcript if needed before proceeding.</p>
            <textarea
              className="w-full p-3 border rounded-md shadow-sm"
              rows={6}
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
            />
            <Button onClick={handleExtractSymptoms} disabled={loading} className="mt-4 px-6 py-3 bg-green-600 text-white rounded-lg shadow hover:bg-green-700">
              Extract Key Symptom
            </Button>
          </div>
        )}

        {step === 'followup' && followUpQuestions.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              Follow-Up Question {currentQuestionIndex + 1} of {followUpQuestions.length}
            </h2>
            <p className="text-lg text-gray-700">{followUpQuestions[currentQuestionIndex]}</p>
            <textarea
              className="w-full p-3 border rounded-md shadow-sm mt-2"
              rows={3}
              placeholder="Your answer..."
              value={followUpAnswers[currentQuestionIndex] || ""}
              onChange={(e) => {
                const newAnswers = [...followUpAnswers];
                newAnswers[currentQuestionIndex] = e.target.value;
                setFollowUpAnswers(newAnswers);
              }}
            />
            <Button
              onClick={handleNextFollowUp}
              className="mt-4 px-6 py-3 bg-purple-600 text-white rounded-lg shadow hover:bg-purple-700"
            >
              Next
            </Button>
          </div>
        )}

        {step === 'final' && (
          <div className="space-y-6 text-center">
            <h2 className="text-3xl font-bold text-gray-900">Guidelines</h2>
            {loading ? (
              <p className="text-lg text-gray-600">Generating guidelines...</p>
            ) : (
              <div className="bg-white p-4 rounded shadow">
                <pre className="whitespace-pre-wrap text-lg text-gray-800">{guidelines}</pre>
              </div>
            )}
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