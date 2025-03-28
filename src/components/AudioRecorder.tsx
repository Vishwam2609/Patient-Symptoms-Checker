import React, { useState, useRef, useEffect } from 'react';

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  autoStart?: boolean;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({ onRecordingComplete, autoStart = false }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.onstop = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          setRecordingTime(0);
        }
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        onRecordingComplete(audioBlob);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
      // Start a timer to display recording time.
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      alert("We couldn't access your microphone. Please check your permissions and try again.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  useEffect(() => {
    if (autoStart) {
      startRecording();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoStart]);

  return (
    <div className="flex flex-col items-center">
      {isRecording && (
        <div className="mb-4 text-red-600 font-semibold animate-pulse">
          Recording... {recordingTime}s
        </div>
      )}
      {isRecording ? (
        <button
          onClick={stopRecording}
          className="px-6 py-3 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-all duration-200"
        >
          Stop Recording
        </button>
      ) : (
        !autoStart && (
          <button
            onClick={startRecording}
            className="px-6 py-3 bg-blue-500 text-white rounded-full shadow-lg hover:bg-blue-600 transition-all duration-200"
          >
            Start Recording
          </button>
        )
      )}
    </div>
  );
};