import { connect } from 'node:tls';

export interface TlsInfo {
  valid: boolean;
  expired: boolean;
  daysLeft: number | null;
  error: string | null;
}

/** Прострочений сертифікат — миттєвий аргумент у продажу, тому перевіряємо окремо. */
export function checkTls(hostname: string, timeoutMs = 6000): Promise<TlsInfo> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: TlsInfo) => {
      if (done) return;
      done = true;
      resolve(r);
    };

    let socket: ReturnType<typeof connect> | null = null;
    const timer = setTimeout(() => {
      socket?.destroy();
      finish({ valid: false, expired: false, daysLeft: null, error: 'timeout' });
    }, timeoutMs);

    try {
      socket = connect(
        { host: hostname, port: 443, servername: hostname, rejectUnauthorized: false, timeout: timeoutMs },
        () => {
          const cert = socket!.getPeerCertificate();
          clearTimeout(timer);
          if (!cert || !cert.valid_to) {
            socket!.destroy();
            return finish({ valid: false, expired: false, daysLeft: null, error: 'no-cert' });
          }
          const until = Date.parse(cert.valid_to);
          const daysLeft = Math.floor((until - Date.now()) / 86_400_000);
          socket!.destroy();
          finish({
            valid: socket!.authorized || daysLeft > 0,
            expired: daysLeft <= 0,
            daysLeft,
            error: socket!.authorized ? null : (socket!.authorizationError as unknown as string) ?? null,
          });
        },
      );

      socket.on('error', (e) => {
        clearTimeout(timer);
        finish({ valid: false, expired: false, daysLeft: null, error: e.message });
      });
    } catch (e) {
      clearTimeout(timer);
      finish({
        valid: false, expired: false, daysLeft: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
