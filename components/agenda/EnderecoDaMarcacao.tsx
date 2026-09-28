"use client";

import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useT } from "@/hooks/i18n/useT";
import { juntarEnderecos, podeSalvarEndereco } from "@/lib/agenda/enderecos";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type Lista = { addresses: string[] };

export function EnderecoDaMarcacao({
  value,
  onChange,
}: {
  value: string;
  onChange: (endereco: string) => void;
}) {
  const t = useT();
  const listaId = useId();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [destacado, setDestacado] = useState(0);
  const termo = value.trim();
  const lista = useQuery({
    queryKey: ["agenda", "enderecos", termo],
    enabled: aberto,
    queryFn: async () =>
      (
        await apiClient.get<{ data: Lista }>(
          `/api/v1/agenda/enderecos?${new URLSearchParams(termo ? { q: termo } : {})}`,
        )
      ).data,
  });
  const salvar = useMutation({
    mutationFn: async (address: string) =>
      (
        await apiClient.post<{ data: { address: string } }>("/api/v1/agenda/enderecos", {
          address,
        })
      ).data,
    onSuccess: (r) => {
      onChange(r.address);
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["agenda", "enderecos"] });
    },
  });

  const conhecidos = juntarEnderecos(lista.data?.addresses ?? [], [], value);
  const ofereceSalvar = podeSalvarEndereco(conhecidos, value) && !lista.isLoading;
  const opcoes = ofereceSalvar ? [...conhecidos, { salvar: true as const }] : conhecidos;
  const mostraLista =
    aberto &&
    (conhecidos.length > 0 || ofereceSalvar || lista.isError || salvar.isError);

  function escolher(endereco: string) {
    onChange(endereco);
    setAberto(false);
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!aberto) setAberto(true);
      else setDestacado((i) => Math.min(i + 1, Math.max(opcoes.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDestacado((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const alvo = opcoes[destacado];
      if (alvo && typeof alvo === "object") salvar.mutate(termo);
      else if (typeof alvo === "string") escolher(alvo);
    } else if (e.key === "Escape") {
      setAberto(false);
    }
  }

  return (
    <div>
      <label className="block" htmlFor="endereco-do-compromisso">
        {t("Endereço")} <span className="font-normal opacity-70">({t("opcional")})</span>
      </label>
      <div className="relative">
        <input
          id="endereco-do-compromisso"
          data-testid="endereco-do-compromisso"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={listaId}
          aria-autocomplete="list"
          aria-activedescendant={aberto ? `${listaId}-${destacado}` : undefined}
          type="text"
          autoComplete="off"
          value={value}
          onFocus={() => {
            setAberto(true);
            setDestacado(0);
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setAberto(true);
            setDestacado(0);
          }}
          onKeyDown={aoTeclar}
          onBlur={() => setAberto(false)}
          className="mt-1 w-full rounded-md border bg-surface p-2 outline-hidden"
          placeholder={t("Rua, número, sala")}
          aria-describedby="ajuda-do-endereco"
        />
        {mostraLista ? (
          <ul
            id={listaId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-surface shadow-md"
            onMouseDown={(e) => e.preventDefault()}
          >
            {conhecidos.map((opcao, i) => (
              <li
                key={opcao}
                id={`${listaId}-${i}`}
                role="option"
                aria-selected={opcao === value}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  i === destacado && "bg-accent text-accent-foreground",
                )}
                onMouseEnter={() => setDestacado(i)}
                onClick={() => escolher(opcao)}
              >
                {opcao}
              </li>
            ))}
            {ofereceSalvar ? (
              <li
                id={`${listaId}-${conhecidos.length}`}
                role="option"
                data-testid="salvar-endereco"
                aria-selected={false}
                aria-disabled={salvar.isPending || undefined}
                className={cn(
                  "min-h-11 cursor-pointer px-3 py-2 text-sm",
                  destacado === conhecidos.length && "bg-accent text-accent-foreground",
                )}
                onMouseEnter={() => setDestacado(conhecidos.length)}
                onClick={() => {
                  if (!salvar.isPending) salvar.mutate(termo);
                }}
              >
                {t("Salvar para os próximos agendamentos")}
                <span className="mt-0.5 block text-xs opacity-70">“{termo}”</span>
              </li>
            ) : null}
            {lista.isError || salvar.isError ? (
              <li role="alert" className="px-3 py-2 text-sm text-error-fg">
                {salvar.isError
                  ? t("Não foi possível salvar o endereço. Tente novamente.")
                  : t("Não foi possível carregar os endereços. Tente novamente.")}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <p id="ajuda-do-endereco" className="mt-1 text-xs text-text-muted">
        {t("Onde o atendimento acontece. Digite para filtrar ou salvar para a próxima vez.")}
      </p>
    </div>
  );
}
