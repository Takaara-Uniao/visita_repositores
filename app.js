import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// ---------- utilitários ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const milhar = (n) => Number(n || 0).toLocaleString('pt-BR');
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const intOuNulo = (v) => { const s = String(v).trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? Math.trunc(n) : NaN; };
const hoje = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtData = (s) => (s ? s.split('-').reverse().join('/') : '');
const msg = (el, tipo, itens) => {
  const lista = [].concat(itens);
  el.innerHTML = lista.length ? `<div class="msg ${tipo}">${lista.length > 1 ? '<ul>' + lista.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>' : esc(lista[0])}</div>` : '';
};

const MOTIVOS = { M1: 'Mercadoria', M2: 'Logística', M3: 'Problema com funcionário', M4: 'Rotina', M5: 'Treinamento', M6: 'Contratação', M7: 'Ação comercial', M8: 'Visita de diretoria', M9: 'Auditoria de padrão', M10: 'Abertura de cliente', M11: 'Documentação / administrativo' };
const VEICULOS = ['VW Saveiro GIC4C43', 'Fiat Strada', 'Terceiro (viagem dividida)'];
const TERCEIRO = VEICULOS[2];
const MAX_KM_DIA = 1000; // o banco recusa acima disto (maior diária da base: 631 km)

// ---------- estado ----------
let sb, user = null, perfil = null, linhas = [], pessoas = [];
let editandoId = null, ultimoKm = null, avisosVistos = '';

// ---------- inicialização ----------
const placeholder = !SUPABASE_URL || SUPABASE_URL.startsWith('COLE_') || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.startsWith('COLE_');
if (placeholder) {
  $('#setup').classList.remove('hide');
} else {
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  iniciar();
}

async function iniciar() {
  montarSelects();
  ligarEventos();
  const { data } = await sb.auth.getSession();
  await aplicarSessao(data.session);
  sb.auth.onAuthStateChange((_ev, session) => { if ((session?.user?.id ?? null) !== (user?.id ?? null)) aplicarSessao(session); });
}

async function aplicarSessao(session) {
  user = session?.user ?? null;
  if (!user) {
    perfil = null; linhas = [];
    $('#app').classList.add('hide');
    $('#login').classList.remove('hide');
    return;
  }
  const { data: p, error } = await sb.from('profiles').select('id,nome,role,ativo').eq('id', user.id).maybeSingle();
  if (error || !p || !p.ativo) {
    await sb.auth.signOut();
    msg($('#l-msg'), 'erro', 'Usuário sem acesso. Fale com o administrador.');
    return;
  }
  perfil = p;
  $('#login').classList.add('hide');
  $('#app').classList.remove('hide');
  $('#h-nome').textContent = perfil.nome;
  $('#h-role').textContent = perfil.role === 'supervisor' ? 'Supervisor' : 'Colaborador';
  $('#tab-todos').classList.toggle('hide', perfil.role !== 'supervisor');
  novoFormulario();
  await carregar();
  abrirAba('lancar');
}

async function carregar() {
  const { data, error } = await sb.from('visitas').select('*')
    .order('data', { ascending: false }).order('created_at', { ascending: false }).limit(2000);
  if (error) { alert('Erro ao carregar: ' + error.message); return; }
  linhas = data || [];
  if (perfil.role === 'supervisor') {
    const { data: ps } = await sb.from('profiles').select('id,nome,role').order('nome');
    pessoas = ps || [];
    montarFiltroPessoas();
  }
  $('#lojas-lista').innerHTML = [...new Set(linhas.map((l) => l.loja))].sort().map((l) => `<option value="${esc(l)}">`).join('');
  renderMeus();
  renderTodos();
}

// ---------- montagem ----------
function montarSelects() {
  $('#f-motivo').innerHTML = '<option value="">Escolha…</option>' + Object.entries(MOTIVOS).map(([k, v]) => `<option value="${k}">${k} — ${v}</option>`).join('');
  $('#f-veiculo').innerHTML = '<option value="">Escolha…</option>' + VEICULOS.map((v) => `<option>${esc(v)}</option>`).join('');
}
function montarFiltroPessoas() {
  const atual = $('#t-pessoa').value;
  $('#t-pessoa').innerHTML = '<option value="">Todos</option>' + pessoas.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
  $('#t-pessoa').value = atual;
}

function ligarEventos() {
  $('#login-form').addEventListener('submit', entrar);
  $('#h-sair').addEventListener('click', () => sb.auth.signOut());
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.tab)));
  $('#f').addEventListener('submit', salvar);
  $('#f-cancelar').addEventListener('click', novoFormulario);
  $('#f-veiculo').addEventListener('change', aoTrocarVeiculo);
  document.querySelectorAll('#f input, #f select, #f textarea').forEach((el) => el.addEventListener('input', () => { atualizarTotal(); avisosVistos = ''; $('#f-salvar').textContent = editandoId ? 'Salvar alterações' : 'Salvar visita'; }));
  ['#t-de', '#t-ate', '#t-pessoa', '#t-busca'].forEach((s) => $(s).addEventListener('input', renderTodos));
  $('#t-csv').addEventListener('click', baixarCsv);
}

function abrirAba(nome) {
  ['lancar', 'meus', 'todos'].forEach((t) => $('#v-' + t).classList.toggle('hide', t !== nome));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === nome));
  window.scrollTo(0, 0);
}

// ---------- login ----------
async function entrar(e) {
  e.preventDefault();
  const btn = $('#l-btn'); btn.disabled = true; $('#l-msg').innerHTML = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-senha').value });
  btn.disabled = false;
  if (error) msg($('#l-msg'), 'erro', 'E-mail ou senha incorretos.');
}

// ---------- formulário ----------
const ids = { comb: '#f-comb', ped: '#f-ped', alim: '#f-alim', hosp: '#f-hosp', outros: '#f-outros', ac_alim: '#f-ac-alim', ac_hosp: '#f-ac-hosp', ac_outros: '#f-ac-outros' };

function novoFormulario() {
  editandoId = null; ultimoKm = null; avisosVistos = '';
  $('#f').reset();
  $('#f-data').value = hoje();
  $('#f-titulo').textContent = 'Nova visita';
  $('#f-salvar').textContent = 'Salvar visita';
  $('#f-cancelar').classList.add('hide');
  $('#f-msg').innerHTML = ''; $('#km-hint').textContent = '';
  aplicarVeiculoUI();
  atualizarTotal();
}

function lerForm() {
  const p = {
    data: $('#f-data').value,
    loja: $('#f-loja').value.trim(),
    cidade: $('#f-cidade').value.trim() || null,
    motivo: $('#f-motivo').value,
    acompanhante: $('#f-acomp').value.trim() || null,
    veiculo: $('#f-veiculo').value || null,
    km_saida: intOuNulo($('#f-kmsaida').value),
    km_chegada: intOuNulo($('#f-kmchegada').value),
    obs: $('#f-obs').value.trim() || null,
  };
  for (const [k, sel] of Object.entries(ids)) p[k] = Math.round(num($(sel).value) * 100) / 100;
  if (p.veiculo === TERCEIRO) { p.km_saida = null; p.km_chegada = null; }
  return p;
}
const somaCustos = (p) => Object.keys(ids).reduce((s, k) => s + p[k], 0);
function atualizarTotal() { $('#f-total').textContent = brl(somaCustos(lerForm())); }

function aplicarVeiculoUI() {
  const terc = $('#f-veiculo').value === TERCEIRO;
  $('#km-bloco').classList.toggle('hide', terc);
  $('#terceiro-hint').classList.toggle('hide', !terc);
}

async function aoTrocarVeiculo() {
  aplicarVeiculoUI();
  ultimoKm = null; $('#km-hint').textContent = '';
  const v = $('#f-veiculo').value;
  if (!v || v === TERCEIRO) return;
  const { data } = await sb.rpc('ultimo_km', { p_veiculo: v });
  if (data) {
    ultimoKm = data;
    $('#km-hint').textContent = `Última chegada registrada deste veículo: ${milhar(data)} km`;
    if (!$('#f-kmsaida').value && !editandoId) { $('#f-kmsaida').value = data; atualizarTotal(); }
  }
}

function checar(p) {
  const erros = [], avisos = [];
  const total = somaCustos(p);
  if (!p.data) erros.push('Informe a data.');
  else if (p.data > hoje()) erros.push('A data não pode ser futura.');
  if (!p.loja) erros.push('Informe a loja.');
  if (!p.motivo) erros.push('Escolha o motivo.');
  if (!p.veiculo) erros.push('Escolha o veículo.');
  for (const [k, sel] of Object.entries(ids)) if (num($(sel).value) < 0) erros.push('Valores não podem ser negativos.');
  const s = p.km_saida, c = p.km_chegada;
  if (Number.isNaN(s) || Number.isNaN(c)) erros.push('KM inválido.');
  else if (p.veiculo && p.veiculo !== TERCEIRO) {
    if ((s !== null && (s < 0 || s > 999999)) || (c !== null && (c < 0 || c > 999999))) erros.push('KM fora da faixa (máximo 999.999). Confira se não digitou um dígito a mais.');
    else if ((s === null) !== (c === null)) erros.push('Preencha o KM de saída e o de chegada.');
    else if (s !== null) {
      if (c < s) erros.push('A chegada não pode ser menor que a saída.');
      else if (c - s > MAX_KM_DIA) erros.push(`${milhar(c - s)} km em um dia passa do limite de ${milhar(MAX_KM_DIA)}. Confira os dois números.`);
      else if (!editandoId && ultimoKm !== null && s !== ultimoKm) avisos.push(`A saída (${milhar(s)}) não bate com a última chegada deste veículo (${milhar(ultimoKm)}).`);
    } else if (total > 0) avisos.push('Há custo lançado sem KM.');
  }
  if (!p.acompanhante && (p.ac_alim || p.ac_hosp || p.ac_outros)) avisos.push('Há custo de acompanhante, mas o nome dele está vazio.');
  return { erros, avisos };
}

async function salvar(e) {
  e.preventDefault();
  const p = lerForm();
  const { erros, avisos } = checar(p);
  if (erros.length) { msg($('#f-msg'), 'erro', erros); return; }
  const chave = JSON.stringify(avisos);
  if (avisos.length && avisosVistos !== chave) {
    avisosVistos = chave;
    msg($('#f-msg'), 'aviso', [...avisos, 'Se estiver certo, toque em "Salvar mesmo assim".']);
    $('#f-salvar').textContent = 'Salvar mesmo assim';
    return;
  }
  const btn = $('#f-salvar'); btn.disabled = true;
  const r = editandoId
    ? await sb.from('visitas').update(p).eq('id', editandoId)
    : await sb.from('visitas').insert({ ...p, user_id: user.id });
  btn.disabled = false;
  if (r.error) { msg($('#f-msg'), 'erro', 'Não salvou: ' + r.error.message); return; }
  const foiEdicao = !!editandoId;
  novoFormulario();
  msg($('#f-msg'), 'ok', foiEdicao ? 'Alterações salvas.' : 'Visita salva.');
  await carregar();
}

function editar(id) {
  const l = linhas.find((x) => x.id === id && x.user_id === user.id);
  if (!l) return;
  editandoId = id; avisosVistos = '';
  $('#f-data').value = l.data; $('#f-loja').value = l.loja; $('#f-cidade').value = l.cidade ?? '';
  $('#f-motivo').value = l.motivo; $('#f-acomp').value = l.acompanhante ?? '';
  $('#f-veiculo').value = l.veiculo ?? ''; $('#f-kmsaida').value = l.km_saida ?? ''; $('#f-kmchegada').value = l.km_chegada ?? '';
  for (const [k, sel] of Object.entries(ids)) $(sel).value = Number(l[k]) ? l[k] : '';
  $('#f-obs').value = l.obs ?? '';
  $('#f-titulo').textContent = 'Editar visita';
  $('#f-salvar').textContent = 'Salvar alterações';
  $('#f-cancelar').classList.remove('hide');
  $('#f-msg').innerHTML = '';
  aplicarVeiculoUI(); atualizarTotal(); abrirAba('lancar');
}

async function excluir(id) {
  if (!window.confirm('Excluir este lançamento?')) return;
  const { error } = await sb.from('visitas').delete().eq('id', id);
  if (error) { alert('Não excluiu: ' + error.message); return; }
  await carregar();
}

// ---------- meus lançamentos ----------
function renderMeus() {
  const meus = linhas.filter((l) => l.user_id === user.id);
  $('#m-vis').textContent = meus.length;
  $('#m-km').textContent = milhar(meus.reduce((s, l) => s + l.km, 0));
  $('#m-tot').textContent = brl(meus.reduce((s, l) => s + Number(l.total), 0));
  $('#m-lista').innerHTML = meus.length ? meus.map((l) => `
    <div class="item">
      <div class="l1"><span>${fmtData(l.data)} · ${esc(l.loja)}</span><span>${brl(l.total)}</span></div>
      <div class="l2"><span class="tag">${esc(l.motivo)}</span> ${esc(MOTIVOS[l.motivo] || '')}${l.km ? ' · ' + milhar(l.km) + ' km' : ''}${l.acompanhante ? ' · com ' + esc(l.acompanhante) : ''}</div>
      <div class="acts"><button type="button" data-ed="${l.id}">Editar</button><button type="button" class="del" data-ex="${l.id}">Excluir</button></div>
    </div>`).join('') : '<p class="hint">Nenhum lançamento ainda.</p>';
  $('#m-lista').querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', () => editar(b.dataset.ed)));
  $('#m-lista').querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => excluir(b.dataset.ex)));
}

// ---------- supervisor ----------
const nomeDe = (id) => pessoas.find((p) => p.id === id)?.nome ?? '—';
function filtrados() {
  const de = $('#t-de').value, ate = $('#t-ate').value, pes = $('#t-pessoa').value, q = $('#t-busca').value.trim().toLowerCase();
  return linhas.filter((l) => (!de || l.data >= de) && (!ate || l.data <= ate) && (!pes || l.user_id === pes) && (!q || l.loja.toLowerCase().includes(q)));
}
function renderTodos() {
  if (!perfil || perfil.role !== 'supervisor') return;
  const f = filtrados();
  $('#t-vis').textContent = f.length;
  $('#t-km').textContent = milhar(f.reduce((s, l) => s + l.km, 0));
  $('#t-tot').textContent = brl(f.reduce((s, l) => s + Number(l.total), 0));

  const por = new Map();
  for (const l of f) {
    const a = por.get(l.user_id) || { v: 0, km: 0, t: 0 };
    a.v++; a.km += l.km; a.t += Number(l.total); por.set(l.user_id, a);
  }
  $('#t-resumo').innerHTML = '<tr><th>Pessoa</th><th class="n">Visitas</th><th class="n">KM</th><th class="n">Total</th></tr>' +
    ([...por.entries()].map(([id, a]) => `<tr><td>${esc(nomeDe(id))}</td><td class="n">${a.v}</td><td class="n">${milhar(a.km)}</td><td class="n">${brl(a.t)}</td></tr>`).join('') || '<tr><td colspan="4" class="hint">Sem lançamentos no filtro.</td></tr>');

  $('#t-tabela').innerHTML = '<tr><th>Data</th><th>Pessoa</th><th>Loja</th><th>Motivo</th><th class="n">KM</th><th class="n">Acomp.</th><th class="n">Total</th></tr>' +
    f.map((l) => `<tr><td>${fmtData(l.data)}</td><td>${esc(nomeDe(l.user_id))}</td><td>${esc(l.loja)}</td><td><span class="tag">${esc(l.motivo)}</span></td><td class="n">${l.km ? milhar(l.km) : '—'}</td><td class="n">${brl(Number(l.ac_alim) + Number(l.ac_hosp) + Number(l.ac_outros))}</td><td class="n">${brl(l.total)}</td></tr>`).join('');
}

function baixarCsv() {
  const cab = ['Data', 'Pessoa', 'Cidade', 'Loja', 'Motivo', 'Acompanhante', 'Veiculo', 'KM saida', 'KM chegada', 'KM', 'Combustivel', 'Pedagio', 'Alimentacao', 'Hospedagem', 'Outros', 'Acomp alimentacao', 'Acomp hospedagem', 'Acomp outros', 'Total', 'Obs'];
  const cel = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const dec = (n) => String(Number(n || 0).toFixed(2)).replace('.', ',');
  const linhasCsv = filtrados().map((l) => [fmtData(l.data), nomeDe(l.user_id), l.cidade, l.loja, l.motivo, l.acompanhante, l.veiculo, l.km_saida, l.km_chegada, l.km, dec(l.comb), dec(l.ped), dec(l.alim), dec(l.hosp), dec(l.outros), dec(l.ac_alim), dec(l.ac_hosp), dec(l.ac_outros), dec(l.total), l.obs].map(cel).join(';'));
  const blob = new Blob(['﻿' + [cab.map(cel).join(';'), ...linhasCsv].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `visitas_${hoje()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
