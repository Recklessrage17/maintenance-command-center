import pathlib,hashlib,json,zipfile,sys,stat
source=pathlib.Path(sys.argv[1]);manifest=pathlib.Path(sys.argv[2]);target=pathlib.Path(sys.argv[3])
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(source)=='248c9bcfe1d1b05a211b13e1791dd7d88bcd1cf868e6318b0f3f1e62fba815e1'
assert sha(manifest)=='4500f67938e83cf2143e5b0aef094a94fa6d5330deb7c84a0ee00a95fe39266a'
inventory=json.loads(manifest.read_bytes());assert inventory['candidate_tree']=='9d4280aef25d511e5e6a636bc2a374b6daeb3893'
expected={f['path']:f for f in inventory['files']};assert len(expected)==476
if not target.exists():target.mkdir()
assert not any(target.iterdir())
with zipfile.ZipFile(source)as z:
 assert len(z.namelist())==len(expected)and set(z.namelist())==set(expected)
 for name in z.namelist():
  p=pathlib.PurePosixPath(name);assert not p.is_absolute()and '..'not in p.parts and '\\'not in name and ':'not in name
  assert stat.S_IFMT(z.getinfo(name).external_attr>>16)in [0,stat.S_IFREG]
  b=z.read(name);assert hashlib.sha256(b).hexdigest()==expected[name]['sha256']
  f=target/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
print('Exact candidate: 476 source files verified, tree 9d4280aef25d511e5e6a636bc2a374b6daeb3893')
