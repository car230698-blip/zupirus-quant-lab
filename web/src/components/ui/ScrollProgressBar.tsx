import React from 'react';
import { motion, useScroll } from 'motion/react';

export const ScrollProgressBar: React.FC = () => {
  const { scrollYProgress } = useScroll();

  return (
    <motion.div
      style={{ scaleX: scrollYProgress, transformOrigin: '0%' }}
      className="fixed top-0 inset-x-0 z-50 h-[2px] bg-gradient-to-r from-[#12B5A6] via-[#38BDF8] to-[#F5B700] pointer-events-none"
    />
  );
};
