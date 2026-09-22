import { z } from 'zod';
import { screenSchema } from './screen.js';

// Tool hosts commonly require named properties on a top-level object. Project
// the shared action union for discovery; execution still validates that union.
const variants = screenSchema.options.map(option => option.shape as Record<string, z.ZodType>);
const names = new Set(variants.flatMap(shape => Object.keys(shape)));
const shape: Record<string, z.ZodType> = {};

for (const name of names) {
  const fields = variants.flatMap(variant => variant[name] ? [variant[name]!] : []);
  const unique = new Map<string, z.ZodType>();
  for (const field of fields) {
    const value = field instanceof z.ZodOptional ? field.unwrap() as z.ZodType : field;
    unique.set(JSON.stringify(z.toJSONSchema(value, { io: 'input' })), value);
  }
  const alternatives = [...unique.values()];
  const field = name === 'action'
    ? z.enum(screenSchema.options.map(option => option.shape.action.value))
    : alternatives.length === 1 ? alternatives[0]! : z.union(alternatives);
  const required = fields.length === variants.length && fields.every(value => !value.isOptional());
  shape[name] = required ? field : field.optional();
}

/** Provider-facing discovery schema; never substitutes for strict screenSchema execution validation. */
export const screenToolSchema = z.object(shape).strict();
