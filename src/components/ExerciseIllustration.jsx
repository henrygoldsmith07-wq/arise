import { useEffect, useState } from 'react';
import { getExerciseImage, hasExerciseImage, getImageFrames } from '../lib/exerciseImages.js';

const SIZE = { sm: 44, md: 72, lg: 128 };

// Animated exercise illustration. The workout-guide package ships 3 SVG
// frames per lift (start → mid → bottom); cycling them plays like a short
// video so users can see the movement, not just a frozen pose. Renders
// nothing for exercises without a mapped illustration, and holds frame 1
// when the user prefers reduced motion.
export default function ExerciseIllustration({ exerciseId, size = 'md', animate = true, className = '' }){
  const frames = getImageFrames(exerciseId);
  const [frame, setFrame] = useState(1);

  useEffect(()=>{
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if(!animate || reduced || frames.length <= 1) return undefined;
    const id = setInterval(()=> setFrame(f => (f % frames.length) + 1), 550);
    return ()=> clearInterval(id);
  }, [animate, frames.length]);

  if(!hasExerciseImage(exerciseId)) return null;
  const img = getExerciseImage(exerciseId, play(frame, frames.length));
  const px = SIZE[size] || SIZE.md;
  return (
    <img
      src={img.url}
      alt={`${exAlt(img)} — illustration`}
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      title={`Illustration © ${img.creator} · ${img.license}`}
      className={`exercise-illustration shrink-0 rounded-xl border border-line bg-surface2 object-contain ${className}`}
    />
  );
}

function play(frame, total){
  return Math.max(1, Math.min(total, frame));
}
function exAlt(img){
  return `${img.primaryMuscle} exercise`;
}
