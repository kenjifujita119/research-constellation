/** An error that keeps the HTTP status code. Callers need it to tell "not built yet (404)" apart
 *  from "actually failed".
 *
 *  The part that builds inside the browser (lib/local.ts) throws the same type — so the pages can
 *  read a 404 as "not there yet" without caring whether the other side is a server or the
 *  browser itself. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
