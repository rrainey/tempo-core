// components/formation/VideoOverlay.tsx
//
// Overlays a GoPro video player on the top-right third of the 3D viewport.
// Synchronized with the formation timeline via currentTime and an offset.

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { ActionIcon, Text, Group, Paper } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

export interface VideoInfo {
  /** URL to stream the video (e.g. /api/video/testCaseId/jumperId/file.MP4) */
  src: string;
  /** Jumper who captured the video */
  jumperId: string;
  /** Video duration in seconds */
  duration_sec: number;
  /** Add to video currentTime to get formation timeOffset */
  videoToFormationOffset_sec: number;
}

interface VideoOverlayProps {
  video: VideoInfo;
  /** Current formation time offset (seconds) — drives video seeking */
  formationTime: number;
  /** Whether the formation is currently playing */
  isPlaying: boolean;
  /** Called when the video's time changes (e.g. during native playback) */
  onFormationTimeChange?: (t: number) => void;
  /** Called when the user closes the overlay */
  onClose?: () => void;
}

export const VideoOverlay: React.FC<VideoOverlayProps> = ({
  video,
  formationTime,
  isPlaying,
  onFormationTimeChange,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isSeeking = useRef(false);
  const [ready, setReady] = useState(false);

  // Convert formation time to video time
  const formationToVideoTime = useCallback(
    (ft: number) => ft - video.videoToFormationOffset_sec,
    [video.videoToFormationOffset_sec]
  );

  const videoTime = formationToVideoTime(formationTime);
  const inRange = videoTime >= 0 && videoTime <= video.duration_sec;

  // Sync video position when formation time changes (scrubbing)
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !ready || isSeeking.current) return;

    if (!inRange) return; // Don't seek when outside video range

    // Only seek if the difference is significant (> 0.3s) to avoid jitter
    if (Math.abs(el.currentTime - videoTime) > 0.3) {
      el.currentTime = videoTime;
    }
  }, [formationTime, videoTime, inRange, ready]);

  // Sync play/pause state
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !ready) return;

    if (isPlaying && inRange) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isPlaying, inRange, ready]);

  // When video plays natively, feed time back to formation
  const handleTimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (!el || !isPlaying) return;

    const formationT = el.currentTime + video.videoToFormationOffset_sec;
    onFormationTimeChange?.(formationT);
  }, [isPlaying, video.videoToFormationOffset_sec, onFormationTimeChange]);

  // Formation time range the video covers
  const videoStartFormation = video.videoToFormationOffset_sec;
  const videoEndFormation = video.videoToFormationOffset_sec + video.duration_sec;

  return (
    <div style={{
      position: 'absolute',
      top: 8,
      left: 8,
      width: '33%',
      zIndex: 10,
      borderRadius: 8,
      overflow: 'hidden',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      backgroundColor: '#000',
    }}>
      {/* Header bar */}
      <Paper
        p={4}
        style={{
          backgroundColor: 'rgba(0,0,0,0.7)',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 11,
        }}
      >
        <Group justify="space-between" px={4}>
          <Text size="xs" c="white" fw={500}>
            {video.jumperId}
            {!inRange && (
              <span style={{ color: '#888', marginLeft: 8 }}>
                (scrub to {videoStartFormation.toFixed(0)}–{videoEndFormation.toFixed(0)}s)
              </span>
            )}
          </Text>
          <ActionIcon
            size="xs"
            variant="subtle"
            color="gray"
            onClick={onClose}
          >
            <IconX size={12} />
          </ActionIcon>
        </Group>
      </Paper>

      <video
        ref={videoRef}
        src={video.src}
        muted
        playsInline
        preload="auto"
        onLoadedData={() => setReady(true)}
        onTimeUpdate={handleTimeUpdate}
        onSeeking={() => { isSeeking.current = true; }}
        onSeeked={() => { isSeeking.current = false; }}
        style={{
          width: '100%',
          display: 'block',
          borderRadius: 8,
          opacity: inRange ? 1 : 0.3,
        }}
      />
    </div>
  );
};
