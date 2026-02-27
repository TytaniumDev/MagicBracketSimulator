/**
 * Lightweight structured logger.
 * Format: [Component] message {context}
 * No external dependencies — wraps console methods with consistent formatting.
 */

type LogContext = Record<string, unknown>;

function formatContext(ctx?: LogContext): string {
  if (!ctx || Object.keys(ctx).length === 0) return '';
  return ' ' + JSON.stringify(ctx);
}

function formatMessage(component: string, message: string, ctx?: LogContext): string {
  return `[${component}] ${message}${formatContext(ctx)}`;
}

export interface Logger {
  info(message: string, ctx?: LogContext): void;
  warn(message: string, ctx?: LogContext): void;
  error(message: string, ctx?: LogContext): void;
}

export function createLogger(component: string): Logger {
  return {
    info(message: string, ctx?: LogContext) {
      console.log(formatMessage(component, message, ctx));
    },
    warn(message: string, ctx?: LogContext) {
      console.warn(formatMessage(component, message, ctx));
    },
    error(message: string, ctx?: LogContext) {
      console.error(formatMessage(component, message, ctx));
    },
  };
}
