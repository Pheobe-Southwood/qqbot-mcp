import { describe, expect, it } from 'vitest';
import { parseDoc } from '../scripts/lib/docs.mjs';

function page(inner: string): string {
  return `<html><body><div class="theme-default-content">${inner}</div><footer class="page-edit"></footer></body></html>`;
}

describe('wiki parser', () => {
  it('parses an autogen page with body, response and error tables', () => {
    const html = page(`
      <h1>发送群聊消息</h1>
      <p>向指定群发送消息。</p>
      <h2>请求</h2>
      <h3>基础信息</h3>
      <table><thead><tr><th>字段</th><th>值</th></tr></thead><tbody>
        <tr><td>HTTP URL</td><td>/v2/groups/{group_openid}/messages</td></tr>
        <tr><td>HTTP Method</td><td>POST</td></tr>
        <tr><td>接口频率限制</td><td>60 QPM</td></tr>
      </tbody></table>
      <h3>参数</h3>
      <table><thead><tr><th>属性</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>
        <tr><td>content</td><td>string</td><td>否</td><td>文本内容</td></tr>
        <tr><td>msg_type</td><td>uint32</td><td>是</td><td>消息类型</td></tr>
      </tbody></table>
      <h3>返回</h3>
      <table><thead><tr><th>字段名</th><th>类型</th><th>描述</th></tr></thead><tbody>
        <tr><td>id</td><td>string</td><td>消息 ID</td></tr>
      </tbody></table>
      <h3>错误码</h3>
      <table><thead><tr><th>错误码</th><th>描述</th><th>排查建议</th></tr></thead><tbody>
        <tr><td>40034100</td><td>主动消息频控</td><td>降低频率</td></tr>
      </tbody></table>
      <h3>示例</h3>
      <pre><code>{"content":"hi","msg_type":0}</code></pre>
    `);
    const parsed = parseDoc(html, {
      expectedPath: '/v2/groups/{group_openid}/messages',
      expectedMethod: 'POST',
    });
    expect(parsed.method).toBe('POST');
    expect(parsed.path).toBe('/v2/groups/{group_openid}/messages');
    expect(parsed.rateLimit).toBe('60 QPM');
    expect(parsed.bodyParams.map((param: { name: string }) => param.name)).toEqual(['content', 'msg_type']);
    expect(parsed.bodyParams[1].required).toBe(true);
    expect(parsed.response.fields.map((field: { name: string }) => field.name)).toContain('id');
    expect(parsed.errors[0]).toMatchObject({ code: '40034100', hint: '降低频率' });
    expect(parsed.examples[0].body).toEqual({ content: 'hi', msg_type: 0 });
  });

  it('scopes parameters to one section of a multi-API page', () => {
    const html = page(`
      <h1>素材管理</h1>
      <h2>申请图片上传</h2>
      <h3>请求参数</h3>
      <table><thead><tr><th>属性</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>
        <tr><td>file_name</td><td>string</td><td>是</td><td>文件名</td></tr>
        <tr><td>md5</td><td>string</td><td>是</td><td>MD5</td></tr>
      </tbody></table>
      <h2>完成图片上传</h2>
      <h3>请求参数</h3>
      <table><thead><tr><th>属性</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>
        <tr><td>upload_id</td><td>string</td><td>是</td><td>上传 ID</td></tr>
        <tr><td>md5</td><td>string</td><td>是</td><td>MD5</td></tr>
      </tbody></table>
    `);
    const prepare = parseDoc(html, { expectedPath: '/v2/media-images/prepare', sectionHeading: '申请图片上传' });
    expect(prepare.bodyParams.map((param: { name: string }) => param.name)).toEqual(['file_name', 'md5']);
    const complete = parseDoc(html, {
      expectedPath: '/v2/media-images/complete',
      sectionHeading: '完成图片上传',
    });
    expect(complete.bodyParams.map((param: { name: string }) => param.name)).toEqual(['upload_id', 'md5']);
  });

  it('keeps nested response models out of query parameters', () => {
    const html = page(`
      <h1>获取 WSS 接入地址</h1>
      <p> GET /gateway/bot </p>
      <h3>返回</h3>
      <table><thead><tr><th>字段名</th><th>类型</th><th>描述</th></tr></thead><tbody>
        <tr><td>url</td><td>string</td><td>地址</td></tr>
        <tr><td>session_start_limit</td><td>SessionStartLimit</td><td>限制</td></tr>
      </tbody></table>
      <h3>SessionStartLimit</h3>
      <table><thead><tr><th>字段名</th><th>类型</th><th>描述</th></tr></thead><tbody>
        <tr><td>total</td><td>int</td><td>总数</td></tr>
        <tr><td>remaining</td><td>int</td><td>剩余</td></tr>
      </tbody></table>
    `);
    const parsed = parseDoc(html, { expectedPath: '/gateway/bot' });
    expect(parsed.method).toBe('GET');
    expect(parsed.queryParams).toEqual([]);
    expect(parsed.response.fields.map((field: { name: string }) => field.name)).toEqual([
      'url',
      'session_start_limit',
    ]);
    expect(parsed.models.SessionStartLimit).toHaveLength(2);
  });

  it('extracts query parameters from the documented URL', () => {
    const html = page(`
      <h1>查询有效图片</h1>
      <pre><code>GET /v2/media-images?cursor={next_cursor}</code></pre>
      <h3>返回参数</h3>
      <table><thead><tr><th>属性</th><th>类型</th><th>说明</th></tr></thead><tbody>
        <tr><td>images</td><td>array</td><td>图片列表</td></tr>
      </tbody></table>
    `);
    const parsed = parseDoc(html, { expectedPath: '/v2/media-images' });
    expect(parsed.method).toBe('GET');
    expect(parsed.path).toBe('/v2/media-images');
    expect(parsed.queryParams.map((param: { name: string }) => param.name)).toContain('cursor');
  });

  it('recognizes path parameters only when the doc labels them', () => {
    const html = page(`
      <h1>获取子频道详情</h1>
      <p>GET /channels/{channel_id}</p>
      <h3>Path 参数</h3>
      <table><thead><tr><th>名称</th><th>类型</th><th>必填</th><th>描述</th></tr></thead><tbody>
        <tr><td>channel_id</td><td>string</td><td>是</td><td>子频道 ID</td></tr>
      </tbody></table>
    `);
    const parsed = parseDoc(html, { expectedPath: '/channels/{channel_id}', expectedMethod: 'GET' });
    expect(parsed.pathParams.map((param: { name: string }) => param.name)).toEqual(['channel_id']);
    expect(parsed.pathParams[0].required).toBe(true);
  });
});
