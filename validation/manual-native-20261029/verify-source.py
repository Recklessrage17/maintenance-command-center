import pathlib,hashlib,json,zipfile,sys,stat
source=pathlib.Path(sys.argv[1]);manifest=pathlib.Path(sys.argv[2]);target=pathlib.Path(sys.argv[3])
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(source)=='122348b9dd9fd0b007a42432ecd9e9a8d6794d372b26f990620870a70239e0c1'
assert sha(manifest)=='0b8606fca1fbc467baba85a8cbef3103865d28d51d7d3e48262f80b0c2f36ae3'
inventory=json.loads(manifest.read_bytes());assert inventory['candidate_tree']=='db9b7b2bce37aa1a8c3b420de3227f1ed2c32669'
expected={f['path']:f for f in inventory['files']};assert len(expected)==466
if not target.exists():target.mkdir()
assert not any(target.iterdir())
with zipfile.ZipFile(source)as z:
 assert len(z.namelist())==len(expected)and set(z.namelist())==set(expected)
 for name in z.namelist():
  p=pathlib.PurePosixPath(name);assert not p.is_absolute()and '..'not in p.parts and '\\'not in name and ':'not in name
  assert stat.S_IFMT(z.getinfo(name).external_attr>>16)in [0,stat.S_IFREG]
  b=z.read(name);assert hashlib.sha256(b).hexdigest()==expected[name]['sha256']
  f=target/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
print('Exact candidate: 466 source files verified, tree db9b7b2bce37aa1a8c3b420de3227f1ed2c32669')
