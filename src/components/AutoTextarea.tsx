import React, { useLayoutEffect, useRef } from 'react';

/** A textarea that grows with its content instead of keeping a fixed height. */
export default function AutoTextarea({ value, className = '', ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} value={value} className={`${className} resize-none overflow-hidden`} {...rest} />;
}
