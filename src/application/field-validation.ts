import { z } from 'zod';
import { ValidationError } from '@/domain/errors/domain-error';
import type { FieldDefinition, FieldSchema } from '@/domain/package/domain-package';
import type { JsonObject, JsonValue } from '@/domain/shared';
import { JsonObjectSchema, JsonValueSchema } from '@/validation/schemas';

export type FieldValidationIssue = {
  field: string;
  code: string;
  message: string;
  expected?: string | string[] | undefined;
  actual?: string | undefined;
};

export function validateInputFieldsAgainstSchema(
  schema: FieldSchema,
  fields: JsonObject,
  source: string,
  options: { requireSchemaRequiredFields?: boolean | undefined } = {}
): void {
  const fieldNames = new Set(Object.keys(fields));
  if (options.requireSchemaRequiredFields === true) {
    for (const [fieldName, definition] of Object.entries(schema.fields)) {
      if (definition.required === true) fieldNames.add(fieldName);
    }
  }

  validateNamedFields(schema, fields, [...fieldNames], source);
}

export function validateRequiredFieldsAgainstSchema(
  schema: FieldSchema,
  fields: JsonObject,
  requiredFields: readonly string[],
  source: string
): void {
  validateNamedFields(schema, fields, [...requiredFields], source);
}

function validateNamedFields(
  schema: FieldSchema,
  fields: JsonObject,
  fieldNames: string[],
  source: string
): void {
  const issues: FieldValidationIssue[] = [];

  for (const fieldName of fieldNames) {
    const definition = schema.fields[fieldName];
    const value = fields[fieldName];

    if (definition == null) {
      if (schema.allowAdditionalFields === true) {
        const additionalResult = JsonValueSchema.safeParse(value);
        if (!additionalResult.success) {
          issues.push({
            field: fieldName,
            code: 'invalid_json_value',
            message: `Field "${fieldName}" must be a supported JSON value`,
            actual: describeActualType(value),
          });
        }
        continue;
      }

      issues.push({
        field: fieldName,
        code: 'unknown_field',
        message: `Field "${fieldName}" is not declared in schema for type "${schema.type}"`,
      });
      continue;
    }

    if (definition.required === true && value === undefined) {
      issues.push({
        field: fieldName,
        code: 'missing_required',
        message: `Field "${fieldName}" is required`,
        expected: expectedFor(definition),
        actual: describeActualType(value),
      });
      continue;
    }

    const result = zodSchemaForField(definition).safeParse(value);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      issues.push({
        field: fieldName,
        code: issueCodeFor(definition, firstIssue?.code),
        message: result.error.issues[0]?.message ?? `Field "${fieldName}" is invalid`,
        expected: expectedFor(definition),
        actual: describeActualType(value),
      });
    }
  }

  if (issues.length > 0) {
    throw new ValidationError('Work item fields do not match package schema', {
      source,
      schemaType: schema.type,
      fields: fieldNames,
      issues,
    });
  }
}

function zodSchemaForField(definition: FieldDefinition): z.ZodType<JsonValue> {
  switch (definition.type) {
    case 'string':
      return definition.minLength != null ? z.string().min(definition.minLength) : z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'object':
      return JsonObjectSchema;
    case 'array':
      return z.array(JsonValueSchema).min(definition.minItems ?? 0);
    case 'enum':
      return z.string().refine((value) => definition.values.includes(value), {
        message: `Value must be one of: ${definition.values.join(', ')}`,
      });
  }
}

function issueCodeFor(definition: FieldDefinition, zodIssueCode?: string | undefined): string {
  if (definition.type === 'enum') return 'invalid_enum_value';
  if (definition.type === 'array' && definition.minItems != null && zodIssueCode === 'too_small') {
    return 'invalid_array';
  }
  if (definition.type === 'string' && definition.minLength != null && zodIssueCode === 'too_small') {
    return 'invalid_string';
  }
  return 'invalid_type';
}

function expectedFor(definition: FieldDefinition): string | string[] {
  if (definition.type === 'enum') return definition.values;
  if (definition.type === 'array' && definition.minItems != null) {
    return `array(minItems=${definition.minItems})`;
  }
  if (definition.type === 'string' && definition.minLength != null) {
    return `string(minLength=${definition.minLength})`;
  }
  return definition.type;
}

function describeActualType(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
