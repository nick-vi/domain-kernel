import type { ApplicationDependencies } from '@/application/dependencies';
import type { FieldSchema } from '@/domain/package/domain-package';

export async function getFieldSchemaForType(
  deps: ApplicationDependencies,
  type: string
): Promise<FieldSchema | null> {
  const cacheKey = `field-schema:${type}`;
  const cached = await deps.cache.get<FieldSchema>(cacheKey);
  if (cached != null) {
    return cached;
  }

  const domainPackage = await deps.packages.getByWorkflowType(type);
  if (domainPackage == null) {
    return null;
  }

  await deps.cache.set(cacheKey, domainPackage.schema);
  return domainPackage.schema;
}
