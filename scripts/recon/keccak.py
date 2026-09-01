def keccak256(msg: bytes) -> bytes:
    RC=[0x1,0x8082,0x800000000000808A,0x8000000080008000,0x808B,0x80000001,
        0x8000000080008081,0x8000000000008009,0x8A,0x88,0x80008009,0x8000000A,
        0x8000808B,0x800000000000008B,0x8000000000008089,0x8000000000008003,
        0x8000000000008002,0x8000000000000080,0x800A,0x800000008000000A,
        0x8000000080008081,0x8000000000008080,0x80000001,0x8000000080008008]
    off=[[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]]
    M=(1<<64)-1
    def rol(x,n): return ((x<<n)|(x>>(64-n)))&M
    rate=136
    m=bytearray(msg); m.append(0x01)
    while len(m)%rate: m.append(0)
    m[-1]^=0x80
    A=[[0]*5 for _ in range(5)]
    for o in range(0,len(m),rate):
        blk=m[o:o+rate]
        for i in range(rate//8):
            A[i%5][i//5]^=int.from_bytes(blk[i*8:i*8+8],'little')
        for r in range(24):
            C=[A[x][0]^A[x][1]^A[x][2]^A[x][3]^A[x][4] for x in range(5)]
            D=[C[(x-1)%5]^rol(C[(x+1)%5],1) for x in range(5)]
            for x in range(5):
                for y in range(5): A[x][y]^=D[x]
            B=[[0]*5 for _ in range(5)]
            for x in range(5):
                for y in range(5): B[y][(2*x+3*y)%5]=rol(A[x][y],off[x][y])
            for x in range(5):
                for y in range(5): A[x][y]=B[x][y]^((~B[(x+1)%5][y])&B[(x+2)%5][y])
            A[0][0]^=RC[r]
    out=bytearray()
    for i in range(rate//8):
        out+=A[i%5][i//5].to_bytes(8,'little')
    return bytes(out[:32])

def h(s): return '0x'+keccak256(s.encode()).hex()
def sel(s): return '0x'+keccak256(s.encode()).hex()[:8]

if __name__=='__main__':
    # self-tests
    assert keccak256(b'').hex()=='c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', keccak256(b'').hex()
    assert h('Transfer(address,address,uint256)')=='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    assert h('Approval(address,address,uint256)')=='0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
    print("SELF-TEST OK (empty, Transfer, Approval topics match canonical)\n")
    print("EVENT TOPIC HASHES:")
    for sig in ['Transfer(address,address,uint256)',
                'TransferWithScaledUI(address,address,uint256,uint256)',
                'UIMultiplierUpdated(uint256,uint256,uint256)']:
        print(f"  {sig}\n    topic0 = {h(sig)}")
    print("\nFUNCTION SELECTORS (4-byte):")
    for sig in ['uiMultiplier()','newUIMultiplier()','effectiveAt()','totalSupplyUI()',
                'balanceOfUI(address)','balanceOf(address)','totalSupply()','decimals()',
                'latestRoundData()','decimals()']:
        print(f"  {sig:<28} {sel(sig)}")
