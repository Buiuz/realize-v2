"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { cpfValido } from "@/regras/cpf";
import { mascararCelular, mascararCep, mascararCpf } from "@/regras/formatacao";
import {
  buscarEnderecoPorCep,
  salvarTitular,
  verificarCpf,
  type EstadoFormulario,
} from "../acoes";

const ESTADO_INICIAL: EstadoFormulario = { erros: {} };

const VAZIO = {
  nome: "",
  cpf: "",
  dataNascimento: "",
  sexo: "",
  celular: "",
  email: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
};

type NomeCampo = keyof typeof VAZIO;
type Existente = NonNullable<EstadoFormulario["cpfExistente"]>;

export function FormularioTitular({ hoje }: { hoje: string }) {
  const [estado, acao, salvando] = useActionState(salvarTitular, ESTADO_INICIAL);
  const [valores, setValores] = useState(VAZIO);
  const [existenteDigitado, setExistenteDigitado] = useState<Existente | null>(null);
  const [cpfTocado, setCpfTocado] = useState(false);
  const [avisoCep, setAvisoCep] = useState("");
  // Só a resposta da última consulta vale, se a pessoa mudar o campo no meio do caminho.
  const ultimaConsultaCep = useRef("");
  const ultimoCpf = useRef("");

  const cpfOk = cpfValido(valores.cpf);
  const mostrarCpfInvalido = cpfTocado && !cpfOk;
  // O aviso vindo do servidor só vale para o CPF que foi enviado.
  const existenteDoServidor =
    estado.cpfExistente && estado.cpfEnviado === valores.cpf ? estado.cpfExistente : null;
  const existente = existenteDigitado ?? existenteDoServidor;

  function alterar(nome: NomeCampo, valor: string) {
    setValores((atuais) => ({ ...atuais, [nome]: valor }));
  }

  function aoDigitar(evento: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    alterar(evento.target.name as NomeCampo, evento.target.value);
  }

  async function aoSairDoCpf() {
    setCpfTocado(true);
    if (!cpfOk) return;
    const cpfConsultado = valores.cpf;
    ultimoCpf.current = cpfConsultado;
    const encontrado = await verificarCpf(cpfConsultado);
    if (ultimoCpf.current === cpfConsultado) setExistenteDigitado(encontrado);
  }

  async function aoSairDoCep() {
    const cep = valores.cep.replace(/\D/g, "");
    if (cep.length !== 8 || ultimaConsultaCep.current === cep) return;
    ultimaConsultaCep.current = cep;
    setAvisoCep("Buscando endereço…");
    const endereco = await buscarEnderecoPorCep(cep);
    if (ultimaConsultaCep.current !== cep) return;
    if (!endereco) {
      setAvisoCep("Não encontramos este CEP. Preencha o endereço abaixo.");
      return;
    }
    setAvisoCep("");
    setValores((atuais) => ({
      ...atuais,
      logradouro: endereco.logradouro,
      bairro: endereco.bairro,
      cidade: endereco.cidade,
      uf: endereco.uf,
    }));
  }

  // Evita a limpeza automática do formulário, que apagaria as escolhas quando há erro.
  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => acao(dados));
  }

  function erroDe(nome: NomeCampo) {
    const mensagem = estado.erros[nome];
    return mensagem ? <p className="erro-campo">{mensagem}</p> : null;
  }

  return (
    <form onSubmit={aoEnviar} className="formulario" noValidate>
      <div className="campo">
        <label htmlFor="nome">Nome completo</label>
        <input id="nome" name="nome" value={valores.nome} onChange={aoDigitar} autoComplete="off" />
        {erroDe("nome")}
      </div>

      <div className="campo">
        <label htmlFor="cpf">CPF</label>
        <input
          id="cpf"
          name="cpf"
          value={valores.cpf}
          inputMode="numeric"
          autoComplete="off"
          placeholder="000.000.000-00"
          aria-invalid={mostrarCpfInvalido}
          onChange={(evento) => {
            setExistenteDigitado(null);
            setCpfTocado(false);
            ultimoCpf.current = "";
            alterar("cpf", mascararCpf(evento.target.value));
          }}
          onBlur={aoSairDoCpf}
        />
        {mostrarCpfInvalido ? <p className="erro-campo">CPF inválido</p> : null}
        {!mostrarCpfInvalido && !existente ? erroDe("cpf") : null}
        {existente ? (
          <div className="cartao-aviso">
            <p>
              Este CPF já está cadastrado: <strong>{existente.nome}</strong>.
            </p>
            <Link href={`/pessoas/${existente.id}`} className="botao botao-secundario">
              Abrir cadastro
            </Link>
          </div>
        ) : null}
      </div>

      <div className="campo">
        <label htmlFor="dataNascimento">Data de nascimento</label>
        <input
          id="dataNascimento"
          name="dataNascimento"
          type="date"
          min="1900-01-01"
          max={hoje}
          value={valores.dataNascimento}
          onChange={aoDigitar}
        />
        {erroDe("dataNascimento")}
      </div>

      <div className="campo">
        <label htmlFor="sexo">Sexo (opcional)</label>
        <select id="sexo" name="sexo" value={valores.sexo} onChange={aoDigitar}>
          <option value="">Não informado</option>
          <option value="feminino">Feminino</option>
          <option value="masculino">Masculino</option>
          <option value="outro">Outro</option>
        </select>
        {erroDe("sexo")}
      </div>

      <div className="campo">
        <label htmlFor="celular">Celular</label>
        <input
          id="celular"
          name="celular"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          placeholder="(21) 90000-0000"
          value={valores.celular}
          onChange={(evento) => alterar("celular", mascararCelular(evento.target.value))}
        />
        {erroDe("celular")}
      </div>

      <div className="campo">
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="off"
          value={valores.email}
          onChange={aoDigitar}
        />
        {erroDe("email")}
      </div>

      <div className="campo">
        <label htmlFor="cep">CEP</label>
        <input
          id="cep"
          name="cep"
          inputMode="numeric"
          autoComplete="off"
          placeholder="00000-000"
          value={valores.cep}
          onChange={(evento) => {
            setAvisoCep("");
            alterar("cep", mascararCep(evento.target.value));
          }}
          onBlur={aoSairDoCep}
        />
        {avisoCep ? <p className="dica-campo">{avisoCep}</p> : null}
        {erroDe("cep")}
      </div>

      <div className="campo">
        <label htmlFor="logradouro">Rua</label>
        <input id="logradouro" name="logradouro" value={valores.logradouro} onChange={aoDigitar} />
        {erroDe("logradouro")}
      </div>

      <div className="campos-lado-a-lado">
        <div className="campo">
          <label htmlFor="numero">Número (opcional)</label>
          <input id="numero" name="numero" value={valores.numero} onChange={aoDigitar} />
        </div>
        <div className="campo">
          <label htmlFor="complemento">Complemento (opcional)</label>
          <input id="complemento" name="complemento" value={valores.complemento} onChange={aoDigitar} />
        </div>
      </div>

      <div className="campo">
        <label htmlFor="bairro">Bairro</label>
        <input id="bairro" name="bairro" value={valores.bairro} onChange={aoDigitar} />
        {erroDe("bairro")}
      </div>

      <div className="campos-lado-a-lado">
        <div className="campo">
          <label htmlFor="cidade">Cidade</label>
          <input id="cidade" name="cidade" value={valores.cidade} onChange={aoDigitar} />
          {erroDe("cidade")}
        </div>
        <div className="campo">
          <label htmlFor="uf">UF</label>
          <input
            id="uf"
            name="uf"
            maxLength={2}
            value={valores.uf}
            onChange={(evento) => alterar("uf", evento.target.value.toUpperCase())}
          />
          {erroDe("uf")}
        </div>
      </div>

      <div className="acoes">
        <button type="submit" className="botao" disabled={!cpfOk || Boolean(existente) || salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        <Link href="/pessoas" className="botao botao-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
