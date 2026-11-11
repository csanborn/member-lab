import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this clears the error, so navigating away recovers without a reload. */
  resetKey: string;
}

interface State {
  error: Error | null;
  resetKey: string;
}

/** Catches render errors in a page, so one broken view does not blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Page crashed', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="container page-error narrow" role="alert">
        <h1>Something went wrong</h1>
        <p>This page hit an error. Your membership is safe. Reload to try again.</p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload the page
        </button>
      </div>
    );
  }
}
