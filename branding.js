const MAX_LOGO_BYTES = 128 * 1024;
function validateLogo(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4 + 40) throw new Error('Logo 最大为 128 KB');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('Logo 仅支持 PNG、JPEG 或 WebP 图片');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_LOGO_BYTES || bytes.toString('base64') !== match[2]) throw new Error('Logo 图片编码无效或超过 128 KB');
  const valid = match[1] === 'png'
    ? bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === 'jpeg'
      ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217
      : bytes.length >= 16 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!valid) throw new Error('Logo 图片格式与内容不匹配');
  return value;
}
const DEFAULT_SITE_NAME = 'InboxHarbor';
function validateSiteName(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error('站点名称必须为文本，且不能包含控制字符');
  const name = value.trim();
  if ([...name].length > 60) throw new Error('站点名称最多 60 个字符');
  return name || DEFAULT_SITE_NAME;
}
function readSiteName(auth) {
  return auth.setting('branding_site_name', DEFAULT_SITE_NAME) || DEFAULT_SITE_NAME;
}
function registerBrandingRoutes(app, auth) {
  const read = () => ({ success: true, logoDataUrl: auth.setting('branding_logo', ''), siteName: readSiteName(auth) });
  app.get('/api/auth/branding', (req,res) => { res.set('Cache-Control','no-store'); res.json(read()); });
  app.put('/api/v1/branding', (req,res) => {
    if (req.user?.role !== 'owner') return res.status(403).json({success:false,message:'仅 Owner 可以修改站点名称和 Logo'});
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('站点设置格式无效');
      const hasLogo = Object.hasOwn(body, 'logoDataUrl'), hasName = Object.hasOwn(body, 'siteName');
      if (!hasLogo && !hasName) throw new Error('请提供站点名称或 Logo');
      const logo = hasLogo ? validateLogo(body.logoDataUrl) : null;
      const name = hasName ? validateSiteName(body.siteName) : null;
      auth.db.exec('BEGIN IMMEDIATE');
      try {
        if (hasLogo) auth.setSetting('branding_logo', logo);
        if (hasName) auth.setSetting('branding_site_name', name);
        auth.audit(req.user, 'instance.branding.updated', 'instance', null, {logoChanged: hasLogo, nameChanged: hasName});
        auth.db.exec('COMMIT');
      } catch (error) { auth.db.exec('ROLLBACK'); throw error; }
      res.json(read());
    } catch (error) { res.status(400).json({success:false,message:error.message}); }
  });
}
module.exports = { registerBrandingRoutes, validateLogo, validateSiteName, readSiteName };
