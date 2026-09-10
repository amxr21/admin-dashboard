type Listener = () => void;

const listeners = new Set<Listener>();
let activeCount = 0;

function emit() {
  listeners.forEach(listener => listener());
}

export function beginLoadingActivity(): () => void {
  let finished = false;
  activeCount += 1;
  emit();

  return () => {
    if (finished) return;
    finished = true;
    activeCount = Math.max(0, activeCount - 1);
    emit();
  };
}

export async function withLoadingActivity<T>(task: () => Promise<T>): Promise<T> {
  const finish = beginLoadingActivity();
  try {
    return await task();
  } finally {
    finish();
  }
}

export function subscribeToLoadingActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLoadingActivitySnapshot(): number {
  return activeCount;
}
