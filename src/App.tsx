import React, { useState, useEffect } from 'react';
import { AudioRecorder } from './components/AudioRecorder';
import { Button } from './components/ui/button';
import { Mic, Loader2 } from 'lucide-react';

const API_BASE_URL = 'https://1b2b-18-216-7-19.ngrok-free.app';

// Static follow-up questions mapping.
const staticFollowUpQuestionsMapping: { [key: string]: string[] } = {
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
  backpain: [
    "When did your backpain start, and is it in a specific area such as your lower back?",
    "Does the pain get worse with movement or remain constant?",
    "Have you engaged in any strenuous activities recently that might have strained your back?"
  ],
  toothache: [
    "When did your toothache begin, and is the pain constant or does it come and go?",
    "How would you describe the pain, and does it spread to nearby areas?",
    "Have you noticed any other dental issues like gum swelling or increased sensitivity?"
  ]
};

/* ---------------- Speech Synthesis Tone Helper ---------------- */
const createUtterance = (text: string): SpeechSynthesisUtterance => {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  const voices = speechSynthesis.getVoices();
  if (voices.length) {
    utterance.voice = voices.find(voice => voice.lang.startsWith('en')) || voices[0];
  }
  return utterance;
};

/* ---------------- API Functions ---------------- */
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

async function generateFollowupQuestions(
  reviewed_transcript: string,
  key_symptom: string,
  static_followup: any[]
): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/generate_followup_questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewed_transcript, key_symptom, static_followup }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Dynamic follow-up question generation failed');
  }
  const data = await response.json();
  return data.follow_up_questions;
}

async function generateGuidelines(
  transcript: string,
  key_symptom: string,
  static_followup: { question: string; answer: string }[],
  dynamic_followup: { question: string; answer: string }[]
): Promise<{ guidelines: string; audio: string }> {
  const allFollowUp = [...static_followup, ...dynamic_followup];
  const followUpText = allFollowUp.map(item => `Q: ${item.question}\nA: ${item.answer}`).join("\n");
  const response = await fetch(`${API_BASE_URL}/generate_guidelines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, key_symptom, follow_up: allFollowUp }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Guideline generation failed');
  }
  const data = await response.json();
  return { guidelines: data.guidelines, audio: data.audio };
}

/* ---------------- Loading Indicator Component ---------------- */
const LoadingIndicator = ({ message }: { message: string }) => (
  <div className="flex flex-col items-center justify-center h-full transition-all duration-300">
    <h2 className="text-2xl font-semibold text-gray-900">{message}</h2>
    <div className="flex flex-col items-center justify-center mt-4 space-y-2">
      <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
      <p className="text-base text-gray-600">Processing, please wait...</p>
    </div>
  </div>
);

/* ---------------- Modal Component for Error Alerts ---------------- */
interface ModalProps {
  message: string;
  onClose: () => void;
}
const Modal: React.FC<ModalProps> = ({ message, onClose }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
    <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full text-center">
      <h2 className="text-xl font-semibold mb-4">Alert</h2>
      <p className="mb-6">{message}</p>
      <Button onClick={onClose} className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600">
        Close
      </Button>
    </div>
  </div>
);

/* ---------------- Main App Component ---------------- */
type AppStep =
  | 'initial'
  | 'recording'
  | 'review'
  | 'followupLoading'
  | 'followup'
  | 'dynamicFollowupLoading'
  | 'dynamicFollowup'
  | 'final';

function App() {
  const [step, setStep] = useState<AppStep>('initial');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [editedTranscript, setEditedTranscript] = useState<string>('');
  const [extractedSymptom, setExtractedSymptom] = useState<string>('');
  const [staticFollowUpQuestions, setStaticFollowUpQuestions] = useState<string[]>([]);
  const [staticFollowUpAnswers, setStaticFollowUpAnswers] = useState<string[]>([]);
  const [dynamicFollowUpQuestions, setDynamicFollowUpQuestions] = useState<string[]>([]);
  const [dynamicFollowUpAnswers, setDynamicFollowUpAnswers] = useState<string[]>([]);
  const [currentStaticIndex, setCurrentStaticIndex] = useState<number>(0);
  const [currentDynamicIndex, setCurrentDynamicIndex] = useState<number>(0);
  const [guidelines, setGuidelines] = useState<string>('');
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [welcomeSpoken, setWelcomeSpoken] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  /* ----------- Error Handling & Speech ----------- */
  const speakErrorAndRedirect = (msg: string) => {
    speechSynthesis.cancel();
    const utterance = createUtterance(`Dear patient, ${msg}`);
    speechSynthesis.speak(utterance);
    setErrorMsg(msg);
  };

  const speakWelcome = () => {
    const utterance = createUtterance(
      "Dear patient, welcome. We're here to help you feel your best. Please share your symptoms by speaking, and we'll guide you through home care. When you're ready, press the Start Recording button to begin."
    );
    speechSynthesis.speak(utterance);
    setWelcomeSpoken(true);
  };

  const handleOverlayClick = () => {
    if (!welcomeSpoken) {
      speakWelcome();
    }
    setOverlayVisible(false);
  };

  const handleStartRecording = () => {
    speechSynthesis.cancel();
    setStep('recording');
  };

  // On review screen, clicking "Proceed to Follow-Up" sets the step to followupLoading.
  const handleProceedToFollowUp = () => {
    setStep('followupLoading');
    setLoading(true);
  };

  useEffect(() => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play().catch(err => console.error("Audio playback failed:", err));
    }
  }, [audioUrl]);

  /* ----------- Recording & Transcription ----------- */
  const handleRecordingComplete = async (blob: Blob) => {
    setRecordedBlob(blob);
    const utterance = createUtterance("Dear patient, your recording has been stopped. We are now processing your message. Please wait a moment.");
    speechSynthesis.speak(utterance);
    setLoading(true);
    try {
      const transcribedText = await transcribeAudio(blob);
      setTranscript(transcribedText);
      setEditedTranscript(transcribedText);
      setStep('review');
    } catch (error: any) {
      console.error("Transcription error:", error);
      speakErrorAndRedirect("we couldn't understand your recording. Please try again.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (step === 'review') {
      speechSynthesis.cancel();
      const utterance = createUtterance("Dear patient, here is your transcribed message. Please review and correct it if necessary. When you're ready, click Proceed to Follow-Up Button to continue.");
      speechSynthesis.speak(utterance);
    }
  }, [step]);

  /* ----------- Transition: Extract Symptom & Check for Follow-Up Questions ----------- */
  useEffect(() => {
    if (step === 'followupLoading') {
      speechSynthesis.cancel();
      const utterance = createUtterance("Dear patient, please wait while we prepare your follow-up questions.");
      speechSynthesis.speak(utterance);
      (async () => {
        try {
          const symptom = await extractSymptoms(editedTranscript);
          const firstLine = symptom.split('\n')[0];
          const cleanedSymptom = firstLine.toLowerCase().trim().replace(/[^a-z]/g, "");
          console.log("Extracted key symptom:", cleanedSymptom);
          setExtractedSymptom(cleanedSymptom);
          if (staticFollowUpQuestionsMapping[cleanedSymptom]) {
            setStaticFollowUpQuestions(staticFollowUpQuestionsMapping[cleanedSymptom]);
            setStaticFollowUpAnswers(Array(staticFollowUpQuestionsMapping[cleanedSymptom].length).fill(""));
            setCurrentStaticIndex(0);
            setStep('followup');
          } else {
            setStep('dynamicFollowupLoading');
          }
        } catch (error: any) {
          console.error("Symptom extraction error:", error);
          speakErrorAndRedirect("we had trouble understanding your symptoms. Please try again.");
        }
        setLoading(false);
      })();
    }
  }, [step, editedTranscript]);

  /* ----------- Static Follow-Up ----------- */
  useEffect(() => {
    if (step === 'followup' && staticFollowUpQuestions.length > 0) {
      speechSynthesis.cancel();
      const utterance = createUtterance(`Dear patient, ${staticFollowUpQuestions[currentStaticIndex]}`);
      speechSynthesis.speak(utterance);
    }
  }, [step, currentStaticIndex, staticFollowUpQuestions]);

  const handleNextStaticFollowUp = () => {
    const answer = staticFollowUpAnswers[currentStaticIndex] || "";
    if (!answer.trim()) {
      alert("Dear patient, please share your answer before proceeding.");
      return;
    }
    if (currentStaticIndex + 1 < staticFollowUpQuestions.length) {
      setCurrentStaticIndex(currentStaticIndex + 1);
    } else {
      setStep('dynamicFollowupLoading');
    }
  };

  /* ----------- Transitional: Dynamic Follow-Up Loading ----------- */
  useEffect(() => {
    if (step === 'dynamicFollowupLoading') {
      speechSynthesis.cancel();
      const utterance = createUtterance("Dear patient, we are generating additional follow-up questions. Please wait a moment.");
      speechSynthesis.speak(utterance);
      setLoading(true);
      (async () => {
        try {
          const staticQA = staticFollowUpQuestions.map((q, i) => ({
            question: q,
            answer: staticFollowUpAnswers[i] || ""
          }));
          const questions = await generateFollowupQuestions(editedTranscript, extractedSymptom, staticQA);
          setDynamicFollowUpQuestions(questions);
          setDynamicFollowUpAnswers(Array(questions.length).fill(""));
          setCurrentDynamicIndex(0);
          setStep('dynamicFollowup');
        } catch (error: any) {
          console.error("Dynamic follow-up generation error:", error);
          speakErrorAndRedirect("we couldn't generate additional follow-up questions. Please try again.");
        }
      })();
    }
  }, [step, transcript, extractedSymptom, staticFollowUpQuestions, staticFollowUpAnswers]);

  /* ----------- Dynamic Follow-Up ----------- */
  useEffect(() => {
    if (step === 'dynamicFollowup' && dynamicFollowUpQuestions.length > 0) {
      speechSynthesis.cancel();
      const utterance = createUtterance(`Dear patient, ${dynamicFollowUpQuestions[currentDynamicIndex]}`);
      speechSynthesis.speak(utterance);
    }
  }, [step, currentDynamicIndex, dynamicFollowUpQuestions]);

  const handleNextDynamicFollowUp = () => {
    const answer = dynamicFollowUpAnswers[currentDynamicIndex] || "";
    if (!answer.trim()) {
      alert("Dear patient, please share your answer before proceeding.");
      return;
    }
    if (currentDynamicIndex + 1 < dynamicFollowUpQuestions.length) {
      setCurrentDynamicIndex(currentDynamicIndex + 1);
    } else {
      setStep('final');
    }
  };

  /* ----------- Final Guidelines ----------- */
  useEffect(() => {
    if (step === "final") {
      speechSynthesis.cancel();
      const utterance = createUtterance("Dear patient, your personalized home care plan is being generated. Please wait a moment.");
      speechSynthesis.speak(utterance);
      setLoading(true);
      (async () => {
        try {
          const staticQA = staticFollowUpQuestions.map((q, i) => ({
            question: q,
            answer: staticFollowUpAnswers[i] || ""
          }));
          const dynamicQA = dynamicFollowUpQuestions.map((q, i) => ({
            question: q,
            answer: dynamicFollowUpAnswers[i] || ""
          }));
          const result = await generateGuidelines(transcript, extractedSymptom, staticQA, dynamicQA);
          setGuidelines(result.guidelines);
          setAudioUrl(result.audio);
        } catch (error: any) {
          console.error("Guideline generation error:", error);
          speakErrorAndRedirect("we couldn't generate your care guidelines. Please try again.");
        }
        setLoading(false);
      })();
    }
  }, [step, transcript, extractedSymptom, staticFollowUpQuestions, staticFollowUpAnswers, dynamicFollowUpQuestions, dynamicFollowUpAnswers]);

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen py-8 bg-gradient-to-br from-blue-100 to-gray-200">
      {overlayVisible && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-start bg-black bg-opacity-60 animate-fadeIn cursor-pointer"
          onClick={handleOverlayClick}
        >
          <div className="mt-16 text-center">
            <h1 className="text-4xl font-bold text-white">Tap to Begin</h1>
            <p className="mt-2 text-lg text-gray-200">Tap anywhere to hear the welcome message.</p>
          </div>
        </div>
      )}

      {errorMsg && <Modal message={errorMsg} onClose={() => setErrorMsg('')} />}

      <div className="w-full max-w-3xl p-8 bg-white rounded-xl shadow-2xl transition-all duration-500">
        {step === 'initial' && (
          <div className="space-y-6 text-center">
            <div className="flex justify-center">
              <div className="flex items-center justify-center w-24 h-24 bg-blue-200 rounded-full shadow-2xl">
                <Mic className="w-12 h-12 text-blue-600" />
              </div>
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900">Welcome, Dear Patient</h1>
            <p className="text-lg text-gray-700">
              We're here to help you feel your best. Share your symptoms by speaking, and we'll guide you through home care.
            </p>
            <Button
              onClick={handleStartRecording}
              className="px-8 py-3 mt-4 text-white bg-blue-600 rounded-lg shadow-xl hover:bg-blue-700 transition-colors"
            >
              <Mic className="w-5 h-5 mr-2" /> Start Recording
            </Button>
          </div>
        )}

        {step === 'recording' && (
          <div className="space-y-6 text-center">
            <AudioRecorder onRecordingComplete={handleRecordingComplete} autoStart={true} />
            {loading && <LoadingIndicator message="Recording..." />}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-6">
            <h2 className="text-3xl font-semibold text-gray-900">Review Your Message</h2>
            <p className="text-gray-700">
              Dear patient, please review and adjust the text so we fully understand you.
            </p>
            <textarea
              className="w-full p-4 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
              rows={6}
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
            />
            <Button
              onClick={handleProceedToFollowUp}
              disabled={loading}
              className="px-8 py-3 mt-4 text-white bg-green-600 rounded-lg shadow-xl hover:bg-green-700 transition-colors"
            >
              Proceed to Follow-Up
            </Button>
          </div>
        )}

        {step === 'followupLoading' && <LoadingIndicator message="Preparing Follow-Up Questions..." />}

        {step === 'followup' && staticFollowUpQuestions.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-3xl font-semibold text-gray-900">
              Static Follow-Up ({currentStaticIndex + 1} of {staticFollowUpQuestions.length})
            </h2>
            <p className="text-xl text-gray-700">{staticFollowUpQuestions[currentStaticIndex]}</p>
            <textarea
              className="w-full p-4 mt-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-colors"
              rows={3}
              placeholder="Type your answer here..."
              value={staticFollowUpAnswers[currentStaticIndex] || ""}
              onChange={(e) => {
                const newAnswers = [...staticFollowUpAnswers];
                newAnswers[currentStaticIndex] = e.target.value;
                setStaticFollowUpAnswers(newAnswers);
              }}
            />
            <Button
              onClick={handleNextStaticFollowUp}
              className="px-8 py-3 mt-4 text-white bg-purple-600 rounded-lg shadow-xl hover:bg-purple-700 transition-colors"
            >
              Next
            </Button>
          </div>
        )}

        {step === 'dynamicFollowupLoading' && <LoadingIndicator message="Generating Follow-Up Questions..." />}

        {step === 'dynamicFollowup' && dynamicFollowUpQuestions.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-3xl font-semibold text-gray-900">
              Dynamic Follow-Up ({currentDynamicIndex + 1} of {dynamicFollowUpQuestions.length})
            </h2>
            <p className="text-xl text-gray-700">{dynamicFollowUpQuestions[currentDynamicIndex]}</p>
            <textarea
              className="w-full p-4 mt-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-colors"
              rows={3}
              placeholder="Type your answer here..."
              value={dynamicFollowUpAnswers[currentDynamicIndex] || ""}
              onChange={(e) => {
                const newAnswers = [...dynamicFollowUpAnswers];
                newAnswers[currentDynamicIndex] = e.target.value;
                setDynamicFollowUpAnswers(newAnswers);
              }}
            />
            <Button
              onClick={handleNextDynamicFollowUp}
              className="px-8 py-3 mt-4 text-white bg-purple-600 rounded-lg shadow-xl hover:bg-purple-700 transition-colors"
            >
              Next
            </Button>
          </div>
        )}

        {step === 'final' && (
          <div className="space-y-6 text-center">
            {loading ? (
              <LoadingIndicator message="Generating Home Care Plan..." />
            ) : (
              <div className="p-6 rounded-md shadow-xl bg-gray-50">
                <pre className="text-lg text-gray-800 whitespace-pre-wrap">{guidelines}</pre>
              </div>
            )}
            <p className="mt-2 text-sm text-gray-600">
              Dear patient, remember these guidelines are informational. For any concerns, please consult your healthcare provider.
            </p>
          </div>
        )}
      </div>
      <footer className="mt-6 text-sm text-center text-gray-500">
        We care about you. Your well-being is our highest priority.
      </footer>
    </div>
  );
}

export default App;