import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/catalog.js';

const catalog = Catalog.load();

describe('generated catalog', () => {
  it('contains every curated API and event', () => {
    expect(catalog.file.apiCount).toBe(103);
    expect(catalog.file.apis).toHaveLength(103);
    expect(catalog.file.categories.length).toBeGreaterThanOrEqual(20);
    expect(catalog.eventFile.eventCount).toBe(53);
    expect(catalog.eventFile.events).toHaveLength(53);
  });

  it('has a complete, non-empty spec for every API', () => {
    for (const api of catalog.file.apis) {
      expect(api.name, 'name').toMatch(/^[a-z][a-z0-9_]*$/);
      expect(api.method, api.name).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(api.path, api.name).toMatch(/^\//);
      expect(api.description.length, api.name).toBeGreaterThan(0);
      expect(api.summary.length, api.name).toBeGreaterThan(0);
      if (!api.legacy) expect(api.docUrl, api.name).toMatch(/^https:\/\/bot\.q\.qq\.com\/wiki\//);
      expect(api.inputSchema.type, api.name).toBe('object');
    }
  });

  it('keeps the C2C/group passive reply and media rules from the docs', () => {
    const c2c = catalog.requireApi('send_c2c_message');
    expect(c2c.description).toContain('60 分钟');
    expect(c2c.description).toContain('4 次');
    expect(c2c.bodySchema.properties?.msg_type?.enum).toEqual([0, 2, 6, 7]);

    const group = catalog.requireApi('send_group_message');
    expect(group.description).toContain('5 分钟');
    expect(group.description).toContain('5 次');
    expect(group.bodySchema.properties?.msg_type?.enum).toEqual([0, 2, 7]);
    expect(group.notes.join(' ')).toContain('msg_seq');
  });

  it('does not leak response models into request parameters', () => {
    const gateway = catalog.requireApi('get_gateway_bot');
    expect(gateway.queryParams).toEqual([]);
    expect(gateway.bodyParams).toEqual([]);

    const prepare = catalog.requireApi('prepare_media_image');
    expect(prepare.bodyParams.map((param) => param.name)).toEqual([
      'file_name',
      'file_size',
      'content_type',
      'md5',
      'sha1',
    ]);
    expect(catalog.requireApi('complete_media_image').bodyParams.map((param) => param.name)).toEqual([
      'upload_id',
      'md5',
    ]);
  });

  it('applies overrides for DMs, audio control and legacy patch', () => {
    const dm = catalog.requireApi('send_dm_message');
    expect(dm.bodyParams.map((param) => param.name)).toEqual(
      expect.arrayContaining(['content', 'markdown', 'keyboard', 'message_reference']),
    );
    const audio = catalog.requireApi('control_channel_audio');
    expect(audio.bodySchema.properties?.status?.enum).toEqual([0, 1, 2, 3]);
    const patch = catalog.requireApi('patch_channel_message');
    expect(patch.legacy).toBe(true);
    expect(patch.bodySchema.properties).toHaveProperty('markdown');
  });

  it('finds APIs by name, alias and Chinese keyword', () => {
    expect(catalog.getApi('send_group_message')?.name).toBe('send_group_message');
    expect(catalog.getApi('post_group_message')?.name).toBe('send_group_message');
    expect(catalog.getApi('SEND_GROUP_MESSAGE')?.name).toBe('send_group_message');
    const hits = catalog.search('撤回');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.name.includes('recall'))).toBe(true);
    expect(catalog.search('markdown').some((hit) => hit.name === 'send_group_message')).toBe(true);
  });

  it('exposes event payloads and intents', () => {
    const event = catalog.requireEvent('C2C_MESSAGE_CREATE');
    expect(event.intents).toContain('GROUP_AND_C2C_EVENT');
    expect(event.payload.map((field) => field.name)).toContain('content');
    expect(catalog.requireEvent('GROUP_AT_MESSAGE_CREATE').intents).toContain('GROUP_AND_C2C_EVENT');
    expect(catalog.listEvents({ intent: 'INTERACTION' }).length).toBeGreaterThan(0);
  });

  it('explains common QQ error codes from the scraped error tables', () => {
    const explained = catalog.explainError(40034005);
    expect(explained?.description.length).toBeGreaterThan(0);
  });
});
