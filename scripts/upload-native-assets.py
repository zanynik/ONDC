# A short-lived Cloudflare upload-session JWT arrives on hidden stdin only.
import sys,json,pathlib,base64,urllib.request,mimetypes,termios,tty
old=None
if sys.stdin.isatty():
 old=termios.tcgetattr(sys.stdin);tty.setraw(sys.stdin.fileno())
sys.stderr.write('Ready for asset session on hidden stdin.\n');sys.stderr.flush()
try:
 data=''
 while '\n' not in data:
  char=sys.stdin.read(1)
  if not char:raise RuntimeError('No upload session')
  data+=char
 config=json.loads(data)
finally:
 if old:termios.tcsetattr(sys.stdin,termios.TCSADRAIN,old)
manifest=json.loads(pathlib.Path('.sites-runtime/assets-manifest.json').read_text())
lookup={v['hash']:k for k,v in manifest.items()};completion=None
for bucket in config['buckets']:
 boundary='ZeroProfitAssetUpload20261029';parts=[]
 for h in bucket:
  name=lookup[h];content=pathlib.Path('dist/client',name.lstrip('/')).read_bytes()
  parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="{h}"; filename="{h}"\r\nContent-Type: {mimetypes.guess_type(name)[0] or "application/octet-stream"}\r\n\r\n'.encode(),base64.b64encode(content),b'\r\n'])
 parts.append(f'--{boundary}--\r\n'.encode())
 req=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/2b1b021020ef414b0a5297a6652f7429/workers/assets/upload?base64=true',data=b''.join(parts),method='POST',headers={'Authorization':'Bearer '+config['jwt'],'Content-Type':'multipart/form-data; boundary='+boundary})
 try:
  with urllib.request.urlopen(req,timeout=50) as response:payload=json.load(response)
 except Exception as e:
  print(json.dumps({'error':'Asset upload failed','type':type(e).__name__}));sys.exit(1)
 if not payload.get('success'):print(json.dumps({'error':'Cloudflare rejected asset upload','errors':payload.get('errors')}));sys.exit(1)
 completion=payload.get('result',{}).get('jwt') or completion
if not config['buckets']:completion=config['jwt']
if not completion:raise RuntimeError('No completion token')
print(json.dumps({'completion_jwt':completion,'uploaded_files':sum(map(len,config['buckets']))}))
