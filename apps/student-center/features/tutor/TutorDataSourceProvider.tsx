'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { getTutorDataSource, type TutorDataSource } from './data';

const TutorDataSourceContext = createContext<TutorDataSource | null>(null);

/**
 * Injects the swappable data source into the tutor tree. Without a provider the
 * tree falls back to the module-level source (the real API by default), so the
 * feature works standalone. Tests/QA can pass a `MockTutorDataSource` here.
 */
export function TutorDataSourceProvider({
  dataSource,
  children,
}: {
  dataSource?: TutorDataSource;
  children: ReactNode;
}) {
  const value = useMemo(() => dataSource ?? getTutorDataSource(), [dataSource]);
  return (
    <TutorDataSourceContext.Provider value={value}>{children}</TutorDataSourceContext.Provider>
  );
}

export function useTutorDataSource(): TutorDataSource {
  const context = useContext(TutorDataSourceContext);
  return context ?? getTutorDataSource();
}
