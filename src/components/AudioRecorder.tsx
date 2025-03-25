import React, { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Mic, Square, Play, Pause, ArrowRight } from 'lucide-react';
import { formatTime } from '@/lib/utils';

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob) => void;
}

export function AudioRecorder({ onRecordingComplete }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  // Store the recording Blob when recording is stopped.
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const timerInterval = useRef<number | null>(null);
  const audioElement = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerInterval.current) {
        window.clearInterval(timerInterval.current);
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];
      setRecordingBlob(null);
      setAudioUrl(null);

      mediaRecorder.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = () => {
        const blob = new Blob(audioChunks.current, { type: 'audio/wav' });
        setRecordingBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        // Note: onRecordingComplete is NOT called here.
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerInterval.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      if (timerInterval.current) {
        window.clearInterval(timerInterval.current);
      }
    }
  };

  const togglePlayback = () => {
    if (!audioElement.current || !audioUrl) return;

    if (isPlaying) {
      audioElement.current.pause();
    } else {
      audioElement.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleNext = () => {
    if (recordingBlob) {
      onRecordingComplete(recordingBlob);
    }
  };

  const handleRerecord = () => {
    // Clear the previous recording so that the AudioRecorder can start fresh.
    setRecordingBlob(null);
    setAudioUrl(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {/* When not recording and no recording exists, show start recording */}
        {!isRecording && !audioUrl && (
          <Button onClick={startRecording} className="flex items-center gap-2">
            <Mic className="w-4 h-4" />
            Start Recording
          </Button>
        )}

        {/* While recording, show the stop recording button */}
        {isRecording && (
          <Button onClick={stopRecording} variant="destructive" className="flex items-center gap-2">
            <Square className="w-4 h-4" />
            Stop Recording
          </Button>
        )}

        {/* When a recording exists (after stop) show playback and re-record controls */}
        {audioUrl && (
          <>
            <audio
              ref={audioElement}
              src={audioUrl}
              onEnded={() => setIsPlaying(false)}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
            />
            <Button onClick={togglePlayback} variant="outline" className="flex items-center gap-2">
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaying ? 'Pause' : 'Play'}
            </Button>
            <Button onClick={handleRerecord} variant="outline" className="flex items-center gap-2">
              <Mic className="w-4 h-4" />
              Re-record
            </Button>
          </>
        )}
      </div>

      {audioUrl && (
        <div className="mt-4">
          <Button onClick={handleNext} className="flex items-center gap-2">
            <ArrowRight className="w-4 h-4" />
            Next
          </Button>
        </div>
      )}

      {isRecording && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Recording...</span>
            <span>{formatTime(recordingTime)}</span>
          </div>
          <Progress value={(recordingTime % 60) * (100 / 60)} />
        </div>
      )}
    </div>
  );
}