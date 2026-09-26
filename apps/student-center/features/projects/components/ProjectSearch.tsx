'use client';

import { useEffect, useRef, useState } from 'react';

export interface ProjectSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** 搜索框：debounce 后写入 `?q=`（验收 4）。 */
export function ProjectSearch({
  value,
  onChange,
  placeholder = '搜索我的项目',
}: ProjectSearchProps) {
  const [text, setText] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onChangeRef.current(text);
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <label className="qitu-project-search">
      <span className="qitu-visually-hidden">搜索项目</span>
      <input
        type="search"
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
      />
    </label>
  );
}
