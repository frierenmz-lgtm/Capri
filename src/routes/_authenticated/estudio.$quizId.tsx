import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { finishQuiz, quizQuery, saveAnswer, type StudyQuestion } from "@/lib/study";
import { scoreQuiz } from "@/lib/study-quiz";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/estudio/$quizId")({
  head: () => ({
    meta: [{ title: "Cuestionario — Capri" }, { name: "description", content: "Responde y revisa tu puntaje." }],
  }),
  component: QuizRunner,
});

function QuizRunner() {
  const { quizId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data } = useQuery(quizQuery(quizId));
  const quiz = data?.quiz ?? null;
  const questions = data?.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (questions.length > 0) {
      const initial: Record<string, number> = {};
      for (const q of questions) if (q.user_answer !== null) initial[q.id] = q.user_answer;
      setAnswers(initial);
      if (questions.every((q) => q.user_answer !== null)) setShowResults(true);
    }
  }, [questions.length, quizId]);

  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id] !== undefined);
  const { correct, total } = scoreQuiz(
    questions.map((q) => ({ answer_index: q.answer_index, user_answer: answers[q.id] ?? null })),
  );

  useEffect(() => {
    if (!allAnswered || !quiz || quiz.score !== null || finishedRef.current) return;
    finishedRef.current = true;
    finishQuiz(quiz.id, correct)
      .then(() => queryClient.invalidateQueries({ queryKey: ["study-quizzes"] }))
      .catch(() => toast.error("No se pudo guardar el puntaje."));
  }, [allAnswered, quiz?.id, quiz?.score, correct, queryClient]);

  if (data && !quiz) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-lg font-medium">Cuestionario no encontrado.</p>
        <Link to="/estudio" className="mt-2 inline-block text-sm text-primary">
          Volver a modo estudio
        </Link>
      </div>
    );
  }
  if (!quiz || questions.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm text-muted-foreground">Cargando cuestionario…</p>
      </div>
    );
  }

  if (showResults) return <Results quizId={quiz.id} topic={quiz.topic} correct={correct} total={total} questions={questions} answers={answers} />;

  const question = questions[index]!;
  const chosen = answers[question.id];
  const answered = chosen !== undefined;

  function answer(optionIdx: number) {
    if (answered) return;
    setAnswers((prev) => ({ ...prev, [question.id]: optionIdx }));
    saveAnswer(question.id, optionIdx).catch(() => toast.error("No se pudo guardar tu respuesta."));
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-6">
      <Link to="/estudio" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Modo estudio
      </Link>
      <h1 className="mt-4 text-xl font-semibold">{quiz.topic}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pregunta {index + 1} de {questions.length} · {correct} correctas hasta ahora
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(Object.keys(answers).length / questions.length) * 100}%` }}
        />
      </div>

      <p className="mt-6 text-lg font-medium">{question.question}</p>
      <div className="mt-4 space-y-2">
        {question.options.map((option, i) => {
          const isCorrect = i === question.answer_index;
          const isChosen = i === chosen;
          return (
            <button
              key={i}
              type="button"
              onClick={() => answer(i)}
              disabled={answered}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm",
                !answered && "hover:bg-sidebar-accent/60",
                answered && isCorrect && "border-green-600 bg-green-600/10",
                answered && isChosen && !isCorrect && "border-red-600 bg-red-600/10",
                answered && !isCorrect && !isChosen && "opacity-60",
              )}
            >
              {answered && isCorrect && <Check className="size-4 shrink-0 text-green-600" />}
              {answered && isChosen && !isCorrect && <X className="size-4 shrink-0 text-red-600" />}
              <span>{option}</span>
            </button>
          );
        })}
      </div>

      {answered && (
        <div className="mt-4 rounded-lg border p-4">
          <p className="text-sm font-medium">
            {chosen === question.answer_index ? "Correcto." : "Incorrecto."}
          </p>
          {question.explanation && <p className="mt-1 text-sm text-muted-foreground">{question.explanation}</p>}
          <Button
            className="mt-3"
            onClick={() => {
              if (index >= questions.length - 1) setShowResults(true);
              else setIndex((v) => v + 1);
            }}
          >
            {index >= questions.length - 1 ? "Ver resultado" : "Siguiente pregunta"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Results({
  topic,
  correct,
  total,
  questions,
  answers,
}: {
  quizId: string;
  topic: string;
  correct: number;
  total: number;
  questions: StudyQuestion[];
  answers: Record<string, number>;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-6">
      <Link to="/estudio" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Modo estudio
      </Link>
      <h1 className="mt-4 text-xl font-semibold">{topic}</h1>
      <Mascot className="mt-4 w-28" />
      <p className="mt-2 text-3xl font-bold">
        {correct} de {total}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {correct === total
          ? "Perfecto, todo correcto."
          : correct >= total / 2
            ? "Bien. Repasa las que fallaste."
            : "Hay que repasar. Revisa las explicaciones."}
      </p>
      <ul className="mt-6 space-y-4">
        {questions.map((q, i) => {
          const chosen = answers[q.id];
          const ok = chosen === q.answer_index;
          return (
            <li key={q.id} className="rounded-lg border p-4">
              <p className="text-sm font-medium">
                {i + 1}. {q.question}
              </p>
              <p className="mt-2 text-sm">
                Tu respuesta:{" "}
                <span className={ok ? "text-green-600" : "text-red-600"}>
                  {chosen !== undefined ? q.options[chosen] : "Sin responder"}
                </span>
              </p>
              {!ok && (
                <p className="mt-1 text-sm">
                  Correcta: <span className="text-green-600">{q.options[q.answer_index]}</span>
                </p>
              )}
              {q.explanation && <p className="mt-1 text-sm text-muted-foreground">{q.explanation}</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex gap-2">
        <Link to="/estudio">
          <Button variant="outline" className="gap-1.5">
            <RotateCcw className="size-4" /> Nuevo cuestionario
          </Button>
        </Link>
      </div>
    </div>
  );
}
