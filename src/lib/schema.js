// schema.js — the minimal schema toolkit Arise's domain model needs.
//
// This replaces the zod dependency: the app validates a fixed set of ~15
// record shapes (sessions, blocks, sets, provenance, export envelopes), and
// zod's full machinery cost 14.5 kB gz in the boot chunk to do it. This
// module implements exactly the subset domain.js and exportPolicy.js use,
// with zod-identical parse semantics:
//   - `.optional()` passes undefined through, `.nullable()` passes null
//     through, `.default(v)` substitutes v for undefined;
//   - `.passthrough()` objects keep unknown keys, plain objects strip them;
//   - coerce variants use String(value) / Number(value) exactly as
//     z.coerce does (including 'null' and 0 edge cases);
//   - safeParse returns { success, data } or { success:false, error:{ issues } }
//     with [{ path, message }] issues, and failure messages match zod's text.
//
// Anything beyond that subset is intentionally absent — add it here only
// with a proven consumer.

function receivedLabel(value){
  if(value === null) return 'null';
  if(Array.isArray(value)) return 'array';
  if(typeof value === 'number' && Number.isNaN(value)) return 'nan';
  return typeof value;
}

function typeIssue(path, expected, value, required){
  return { path, message: required ? 'Required' : `Expected ${expected}, received ${receivedLabel(value)}` };
}

class Schema {
  constructor(parse){ this._parse = parse; this._optional = false; }
  safeParse(value){
    const issues = [];
    const data = this._parse(value, [], issues);
    return issues.length ? { success: false, error: { issues } } : { success: true, data };
  }
  parse(value){
    const result = this.safeParse(value);
    if(!result.success){
      const err = new Error(result.error.issues.map(i=> i.message).join('; '));
      err.issues = result.error.issues;
      throw err;
    }
    return result.data;
  }
  optional(){
    const inner = this;
    const out = new Schema((value, path, issues)=> value === undefined ? undefined : inner._parse(value, path, issues));
    out._optional = true;
    return out;
  }
  nullable(){
    const inner = this;
    return new Schema((value, path, issues)=> value === null ? null : inner._parse(value, path, issues));
  }
  default(fallback){
    const inner = this;
    const out = new Schema((value, path, issues)=> value === undefined ? fallback : inner._parse(value, path, issues));
    out._optional = true;
    return out;
  }
  refine(predicate, message){
    const inner = this;
    return new Schema((value, path, issues)=>{
      const before = issues.length;
      const data = inner._parse(value, path, issues);
      if(issues.length === before && !predicate(data)) issues.push({ path, message });
      return data;
    });
  }
  brand(){ return this; }
  min(count){
    const inner = this;
    return new Schema((value, path, issues)=>{
      const data = inner._parse(value, path, issues);
      if(typeof data === 'string' && data.length < count){
        issues.push({ path, message: `String must contain at least ${count} character(s)` });
      }
      return data;
    });
  }
  int(){
    const inner = this;
    return new Schema((value, path, issues)=>{
      const data = inner._parse(value, path, issues);
      if(typeof data === 'number' && !Number.isInteger(data)){
        issues.push({ path, message: 'Expected integer, received float' });
      }
      return data;
    });
  }
  positive(){
    const inner = this;
    return new Schema((value, path, issues)=>{
      const data = inner._parse(value, path, issues);
      if(typeof data === 'number' && !(data > 0)){
        issues.push({ path, message: 'Number must be greater than 0' });
      }
      return data;
    });
  }
  passthrough(){
    this._passthrough = true;
    return this;
  }
}

function stringSchema(){
  return new Schema((value, path, issues)=>{
    if(typeof value !== 'string'){ issues.push(typeIssue(path, 'string', value)); return undefined; }
    return value;
  });
}

function coerceStringSchema(){
  return new Schema((value)=> String(value));
}

function numberSchema(){
  return new Schema((value, path, issues)=>{
    if(typeof value !== 'number' || Number.isNaN(value)){ issues.push(typeIssue(path, 'number', value)); return undefined; }
    return value;
  });
}

function coerceNumberSchema(){
  return new Schema((value, path, issues)=>{
    const num = Number(value);
    if(Number.isNaN(num)){ issues.push(typeIssue(path, 'number', value)); return undefined; }
    return num;
  });
}

function booleanSchema(){
  return new Schema((value, path, issues)=>{
    if(typeof value !== 'boolean'){ issues.push(typeIssue(path, 'boolean', value)); return undefined; }
    return value;
  });
}

function literalSchema(expected){
  return new Schema((value, path, issues)=>{
    if(value !== expected){ issues.push({ path, message: `Invalid literal value, expected ${JSON.stringify(expected)}` }); return undefined; }
    return value;
  });
}

function enumSchema(values){
  return new Schema((value, path, issues)=>{
    if(!values.includes(value)){
      issues.push({ path, message: `Invalid enum value. Expected ${values.map(v=> `'${v}'`).join(' | ')}, received '${value}'` });
      return undefined;
    }
    return value;
  });
}

function arraySchema(item){
  return new Schema((value, path, issues)=>{
    if(!Array.isArray(value)){ issues.push(typeIssue(path, 'array', value)); return undefined; }
    return value.map((entry, index)=> item._parse(entry, [...path, index], issues));
  });
}

function objectSchema(shape, { passthrough = false } = {}){
  const schema = new Schema((value, path, issues)=>{
    if(value === null || typeof value !== 'object' || Array.isArray(value)){
      issues.push(typeIssue(path, 'object', value));
      return undefined;
    }
    // zod's output order: shape keys first (in declaration order), then any
    // passthrough extras. A key explicitly present in the input stays present
    // even when its parsed value is undefined; an absent key is omitted
    // unless its schema supplies a default.
    const out = {};
    for(const [key, field] of Object.entries(shape)){
      const present = Object.prototype.hasOwnProperty.call(value, key);
      const raw = value[key];
      if(raw === undefined && !field._optional){
        issues.push(typeIssue([...path, key], 'value', raw, true));
        continue;
      }
      const data = field._parse(raw, [...path, key], issues);
      if(present || data !== undefined) out[key] = data;
    }
    if(schema._passthrough){
      for(const key of Object.keys(value)){
        if(!Object.prototype.hasOwnProperty.call(shape, key)) out[key] = value[key];
      }
    }
    return out;
  });
  schema._passthrough = passthrough;
  return schema;
}

export const z = {
  string: stringSchema,
  number: numberSchema,
  boolean: booleanSchema,
  coerce: { string: coerceStringSchema, number: coerceNumberSchema },
  literal: literalSchema,
  enum: enumSchema,
  array: arraySchema,
  object: objectSchema,
};
