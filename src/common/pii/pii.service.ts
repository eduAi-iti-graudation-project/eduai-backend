import { Injectable } from '@nestjs/common';

interface RedactionResult {
  redacted: string;
  replacements: Map<string, string>;
}

@Injectable()
export class PiiService {
  private readonly namePattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  private readonly emailPattern =
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  private readonly uuidPattern =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

  redact(text: string): RedactionResult {
    const replacements = new Map<string, string>();
    let redacted = text;
    let index = 0;

    const replaceWithPlaceholder = (match: string): string => {
      const placeholder = `[REDACTED_${index++}]`;
      replacements.set(placeholder, match);
      return placeholder;
    };

    redacted = redacted.replace(this.emailPattern, replaceWithPlaceholder);
    redacted = redacted.replace(this.uuidPattern, replaceWithPlaceholder);
    redacted = redacted.replace(this.namePattern, replaceWithPlaceholder);

    return { redacted, replacements };
  }

  restore(redacted: string, replacements: Map<string, string>): string {
    let result = redacted;
    for (const [placeholder, original] of replacements) {
      result = result.replace(placeholder, original);
    }
    return result;
  }
}
