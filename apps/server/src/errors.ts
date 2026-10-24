export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export class AbortedError extends Error {
  constructor() {
    super("The generation was stopped.");
    this.name = "AbortedError";
  }
}
