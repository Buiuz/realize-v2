// Grafismo hexagonal do brandbook: colmeia nas laterais, com o centro livre para o conteúdo.
// Regras seguidas: hexágonos do mesmo tamanho, ponta para cima e compartilhando lados; tons de cinza
// (traço #A9A9A9 e bolinhas #A0A0A0 sobre #EDEDED); sem sombra, gradiente ou distorção.

const RAIO = 34;
const LARGURA = Math.sqrt(3) * RAIO;
const LINHAS = 16;
const COLUNAS = 4;
const TONS = ["#F7F7F7", "#F1F1F1", "#EBEBEB", "#E5E5E5", "#DFDFDF", "#D9D9D9", "#D3D3D3", "#CDCDCD"];

function centro(coluna: number, linha: number) {
  const deslocamento = linha % 2 === 1 ? LARGURA / 2 : 0;
  return { x: coluna * LARGURA + deslocamento, y: linha * RAIO * 1.5 };
}

function vertices(x: number, y: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const angulo = (Math.PI / 180) * (60 * i - 90);
    return [
      Number((x + RAIO * Math.cos(angulo)).toFixed(1)),
      Number((y + RAIO * Math.sin(angulo)).toFixed(1)),
    ] as const;
  });
}

/** Sequência fixa: o desenho é sempre igual e fica mais rarefeito na direção do centro da página. */
function presente(coluna: number, linha: number) {
  const sorteio = (linha * 7 + coluna * 13 + linha * coluna * 3) % 10;
  return sorteio < [10, 8, 5, 2][coluna];
}

function Lado({ classe }: { classe: string }) {
  const celulas = [];
  for (let linha = 0; linha < LINHAS; linha += 1) {
    for (let coluna = 0; coluna < COLUNAS; coluna += 1) {
      if (presente(coluna, linha)) celulas.push({ coluna, linha, ...centro(coluna, linha) });
    }
  }
  const tonais = celulas.filter((c) => (c.linha + c.coluna * 2) % 3 === 0);
  const tracadas = celulas.filter((c) => (c.linha + c.coluna * 2) % 3 !== 0);

  return (
    <svg
      className={`colmeia ${classe}`}
      viewBox={`0 0 ${Math.round(LARGURA * 3.5)} ${Math.round(RAIO * 1.5 * LINHAS)}`}
      preserveAspectRatio="xMinYMin slice"
      aria-hidden="true"
    >
      {tonais.map((c, i) => (
        <polygon
          key={`t-${c.coluna}-${c.linha}`}
          points={vertices(c.x, c.y).join(" ")}
          fill={TONS[i % TONS.length]}
        />
      ))}
      {tracadas.map((c) => {
        const pontos = vertices(c.x, c.y);
        return (
          <g key={`c-${c.coluna}-${c.linha}`}>
            <polygon points={pontos.join(" ")} fill="none" stroke="#A9A9A9" strokeWidth="1" />
            {pontos.map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" fill="#A0A0A0" />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function Colmeia() {
  return (
    <>
      <Lado classe="colmeia-esquerda" />
      <Lado classe="colmeia-direita" />
    </>
  );
}
