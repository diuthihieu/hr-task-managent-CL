// Dependency-free error types, usable from scripts (seed) and route handlers alike.

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "Not signed in");
export const forbidden = (msg = "You don't have permission to do this") => new HttpError(403, msg);
export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`);
export const badRequest = (msg: string) => new HttpError(400, msg);
