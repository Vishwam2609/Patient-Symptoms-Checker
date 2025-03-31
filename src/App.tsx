import React, { useState, useEffect } from 'react';
import { AudioRecorder } from './components/AudioRecorder';
import { Button } from './components/ui/button';
import { Mic } from 'lucide-react';

const API_BASE_URL = 'https://8341-100-27-249-117.ngrok-free.app';

// Static follow-up questions mapping (keys: "fever", "coughing", "headache", "backpain", "toothache")
const staticFollowUpQuestionsMapping: { [key: string]: string[] } = {
  fever: [
    "Dear patient, when did you first notice your fever, and has your temperature been consistently high or fluctuating?",
    "Dear patient, are you experiencing any other symptoms like chills, sweating, or body aches?",
    "Dear patient, have you had any recent exposures—such as travel or contact with someone ill—that might explain your fever?"
  ],
  coughing: [
    "Dear patient, when did your cough start, and is it persistent or intermittent?",
    "Dear patient, is your cough dry, or are you producing any phlegm? If so, what color is it?",
    "Dear patient, do you have any other breathing difficulties, such as shortness of breath or chest tightness?"
  ],
  headache: [
    "Dear patient, when did your headache begin, and how would you describe its intensity and duration?",
    "Dear patient, is the headache concentrated in one area or more generalized?",
    "Dear patient, are you experiencing nausea, sensitivity to light or sound, or any visual disturbances?"
  ],
  backpain: [
    "Dear patient, when did your backpain start, and is it in a specific area such as your lower back?",
    "Dear patient, does the pain get worse with movement or remain constant?",
    "Dear patient, have you engaged in any strenuous activities recently that might have strained your backpain?"
  ],
  toothache: [
    "Dear patient, when did your toothache begin, and is the pain constant or does it come and go?",
    "Dear patient, how would you describe the pain, and does it spread to nearby areas?",
    "Dear patient, have you noticed any other dental issues like gum swelling or increased sensitivity?"
  ]
};

/* ---------------- Speech Synthesis Tone Helper ---------------- */
const createUtterance = (text: string): SpeechSynthesisUtterance => {
  const utterance = new SpeechSynthesisUtterance(text);
  // Use a consistent, friendly tone.
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

async function generateFollowupQuestions(transcript: string, key_symptom: string): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/generate_followup_questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, key_symptom }),
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
  // Combine both static and dynamic Q&A.
  const allFollowUp = [...static_followup, ...dynamic_followup];
  const followUpText = allFollowUp.map(item => `Q: ${item.question}\nA: ${item.answer}`).join("\n");
  const detailed_context = (
    "Conversation so far:\n" +
    `Patient's description: ${transcript}\n` +
    `Key symptom: ${key_symptom}\n` +
    `Follow-up Q&A:\n${followUpText}\n`
  );
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

/* ---------------- Main App Component ---------------- */
function App() {
  // Define the steps: 'initial', 'recording', 'review', 'followup' (static), 'dynamicFollowup', 'final'
  const [step, setStep] = useState<'initial' | 'recording' | 'review' | 'followup' | 'dynamicFollowup' | 'final'>('initial');
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

  // Generalized error speech: speak message and redirect.
  const speakErrorAndRedirect = (msg: string) => {
    speechSynthesis.cancel();
    const utterance = createUtterance(`Dear patient, ${msg}`);
    speechSynthesis.speak(utterance);
    if (window.confirm(msg)) {
      setStep('initial');
    }
  };

  const speakWelcome = () => {
    const utterance = createUtterance(
      "Dear patient, welcome. We're here to help you feel your best. Please share your symptoms by speaking, and we'll guide you through home care. When you're ready, press the Start Recording button to begin."
    );
    speechSynthesis.speak(utterance);
    setWelcomeSpoken(true);
  };

  // Overlay handling.
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

  useEffect(() => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play().catch(err => console.error("Audio playback failed:", err));
    }
  }, [audioUrl]);

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

  // Speak review instructions.
  useEffect(() => {
    if (step === 'review') {
      speechSynthesis.cancel();
      const utterance = createUtterance("Dear patient, here is your transcribed message. Please review and correct it if necessary. When you're ready, click Proceed to Follow-Up to continue.");
      speechSynthesis.speak(utterance);
    }
  }, [step]);

  // Handle static follow-up questions.
  const handleExtractSymptoms = async () => {
    if (!editedTranscript) return;
    setLoading(true);
    try {
      const symptom = await extractSymptoms(editedTranscript);
      // Use only the first line and clean up the symptom.
      const firstLine = symptom.split('\n')[0];
      const cleanedSymptom = firstLine.toLowerCase().trim().replace(/[^a-z]/g, "");
      setExtractedSymptom(cleanedSymptom);
      // Check for static questions for this symptom.
      if (staticFollowUpQuestionsMapping[cleanedSymptom]) {
        const questions = staticFollowUpQuestionsMapping[cleanedSymptom];
        setStaticFollowUpQuestions(questions);
        setStaticFollowUpAnswers(Array(questions.length).fill(""));
        setCurrentStaticIndex(0);
        setStep('followup');
      } else {
        // If no static questions are available, generate dynamic follow-up directly.
        const questions = await generateFollowupQuestions(editedTranscript, cleanedSymptom);
        setDynamicFollowUpQuestions(questions);
        setDynamicFollowUpAnswers(Array(questions.length).fill(""));
        setCurrentDynamicIndex(0);
        setStep('dynamicFollowup');
      }
    } catch (error: any) {
      console.error("Symptom extraction error:", error);
      speakErrorAndRedirect("we had trouble understanding your symptoms. Please try again.");
    }
    setLoading(false);
  };

  // Speak each static follow-up question.
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
      // After static follow-up, generate dynamic follow-up questions.
      (async () => {
        setLoading(true);
        try {
          const questions = await generateFollowupQuestions(editedTranscript, extractedSymptom);
          setDynamicFollowUpQuestions(questions);
          setDynamicFollowUpAnswers(Array(questions.length).fill(""));
          setCurrentDynamicIndex(0);
          const utterance = createUtterance(`Dear patient, ${questions[0]}`);
          speechSynthesis.speak(utterance);
          setStep('dynamicFollowup');
        } catch (error: any) {
          console.error("Dynamic follow-up generation error:", error);
          speakErrorAndRedirect("we couldn't generate additional follow-up questions. Please try again.");
        }
        setLoading(false);
      })();
    }
  };

  // Speak each dynamic follow-up question.
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

  // Final step: speak final instructions and generate guidelines.
  useEffect(() => {
    if (step === "final") {
      speechSynthesis.cancel();
      const utterance = createUtterance("Dear patient, your personalized home care plan is being generated. Please wait a moment.");
      speechSynthesis.speak(utterance);
      (async () => {
        setLoading(true);
        try {
          // Prepare Q&A data from static and dynamic phases.
          const staticQA = staticFollowUpQuestions.map((q, i) => ({
            question: q,
            answer: staticFollowUpAnswers[i] || ""
          }));
          const dynamicQA = dynamicFollowUpQuestions.map((q, i) => ({
            question: q,
            answer: dynamicFollowUpAnswers[i] || ""
          }));
          const result = await generateGuidelines(editedTranscript, extractedSymptom, staticQA, dynamicQA);
          setGuidelines(result.guidelines);
          setAudioUrl(result.audio);
        } catch (error: any) {
          console.error("Guideline generation error:", error);
          speakErrorAndRedirect("we couldn't generate your care guidelines. Please try again.");
        }
        setLoading(false);
      })();
    }
  }, [step, editedTranscript, extractedSymptom, staticFollowUpQuestions, staticFollowUpAnswers, dynamicFollowUpQuestions, dynamicFollowUpAnswers]);

  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-gray-100 py-8">
      {overlayVisible && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-start bg-black bg-opacity-50 text-white p-4"
          onClick={handleOverlayClick}
        >
          <div className="mt-20 text-center w-full">
            <h1 className="text-3xl font-bold">Tap to Continue</h1>
            <p className="mt-2">Tap here to start and hear the welcome message.</p>
          </div>
        </div>
      )}
      <div className="max-w-3xl w-full p-6 bg-white rounded-xl shadow-xl transition-all duration-500 ease-in-out">
        {step === 'initial' && (
          <div className="space-y-6 text-center">
            <div className="flex justify-center">
              <div className="flex items-center justify-center w-20 h-20 bg-blue-200 rounded-full shadow-xl">
                <Mic className="w-10 h-10 text-blue-600" />
              </div>
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900">Welcome, Dear Patient</h1>
            <p className="text-lg text-gray-700">
              We're here to help you feel your best. Share your symptoms by speaking, and we'll guide you through home care.
            </p>
            <Button onClick={handleStartRecording} className="px-6 py-3 mt-4 text-white bg-blue-600 rounded-lg shadow-xl hover:bg-blue-700 transition-colors">
              <Mic className="w-5 h-5 mr-2" /> Start Recording
            </Button>
          </div>
        )}
        {step === 'recording' && (
          <div className="space-y-6 text-center">
            <h2 className="text-3xl font-semibold text-gray-900">Recording...</h2>
            <AudioRecorder onRecordingComplete={handleRecordingComplete} autoStart={true} />
            {loading && <p className="mt-4 text-gray-600">Listening...</p>}
          </div>
        )}
        {step === 'review' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-gray-900">Review Your Message</h2>
            <p className="text-gray-700">Dear patient, please review and adjust the text so we fully understand you.</p>
            <textarea
              className="w-full p-3 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              rows={6}
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
            />
            <Button onClick={handleExtractSymptoms} disabled={loading} className="px-6 py-3 mt-4 text-white bg-green-600 rounded-lg shadow-xl hover:bg-green-700 transition-colors">
              Proceed to Follow-Up
            </Button>
          </div>
        )}
        {step === 'followup' && staticFollowUpQuestions.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              Static Follow-Up ({currentStaticIndex + 1} of {staticFollowUpQuestions.length})
            </h2>
            <p className="text-lg text-gray-700">{staticFollowUpQuestions[currentStaticIndex]}</p>
            <textarea
              className="w-full p-3 mt-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              rows={3}
              placeholder="Type your answer here..."
              value={staticFollowUpAnswers[currentStaticIndex] || ""}
              onChange={(e) => {
                const newAnswers = [...staticFollowUpAnswers];
                newAnswers[currentStaticIndex] = e.target.value;
                setStaticFollowUpAnswers(newAnswers);
              }}
            />
            <Button onClick={handleNextStaticFollowUp} className="px-6 py-3 mt-4 text-white bg-purple-600 rounded-lg shadow-xl hover:bg-purple-700 transition-colors">
              Next
            </Button>
          </div>
        )}
        {step === 'dynamicFollowup' && dynamicFollowUpQuestions.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              Dynamic Follow-Up ({currentDynamicIndex + 1} of {dynamicFollowUpQuestions.length})
            </h2>
            <p className="text-lg text-gray-700">{dynamicFollowUpQuestions[currentDynamicIndex]}</p>
            <textarea
              className="w-full p-3 mt-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              rows={3}
              placeholder="Type your answer here..."
              value={dynamicFollowUpAnswers[currentDynamicIndex] || ""}
              onChange={(e) => {
                const newAnswers = [...dynamicFollowUpAnswers];
                newAnswers[currentDynamicIndex] = e.target.value;
                setDynamicFollowUpAnswers(newAnswers);
              }}
            />
            <Button onClick={handleNextDynamicFollowUp} className="px-6 py-3 mt-4 text-white bg-purple-600 rounded-lg shadow-xl hover:bg-purple-700 transition-colors">
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
              <div className="p-4 bg-gray-50 rounded-md shadow-xl">
                <pre className="text-lg text-gray-800 whitespace-pre-wrap">{guidelines}</pre>
              </div>
            )}
            <p className="text-sm text-gray-600 mt-2">
              Dear patient, remember these guidelines are informational. For any concerns, please consult your healthcare provider.
            </p>
          </div>
        )}
      </div>
      <footer className="mt-4 text-sm text-center text-gray-500">
        We care about you. Your well-being is our highest priority.
      </footer>
    </div>
  );
}

export default App;