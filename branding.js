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
function registerBrandingRoutes(app, auth) {
  const read = () => ({ success: true, logoDataUrl: auth.setting('branding_logo', '') });
  app.get('/api/auth/branding', (req,res) => { res.set('Cache-Control','no-store'); res.json(read()); });
  app.put('/api/v1/branding', (req,res) => {
    if (req.user?.role !== 'owner') return res.status(403).json({success:false,message:'仅 Owner 可以修改站点 Logo'});
    try {
      const logo = validateLogo(req.body?.logoDataUrl);
      auth.db.exec('BEGIN IMMEDIATE');
      try {
        auth.setSetting('branding_logo', logo);
        auth.audit(req.user, 'instance.branding.updated', 'instance', null, {customLogo: Boolean(logo)});
        auth.db.exec('COMMIT');
      } catch (error) { auth.db.exec('ROLLBACK'); throw error; }
      res.json(read());
    } catch (error) { res.status(400).json({success:false,message:error.message}); }
  });
}
module.exports = { registerBrandingRoutes, validateLogo };
