import type { Db, ObjectId } from "mongodb";
import type { ParticipantMode } from "./period";

export type RecurrenceDoc = {
	_id: ObjectId;
	groupId: ObjectId;
	createdBy: string;
	paidBy: string;
	description: string;
	amountCents: number;
	dayOfMonth: number;
	participantMode: ParticipantMode;
	/** Só vale para "selected". */
	participantUids: string[];
	startPeriod: string;
	/** Último mês que ainda gera. */
	endPeriod?: string;
	/** Próximo mês a gerar. */
	nextPeriod: string;
	active: boolean;
	createdAt: Date;
	updatedAt: Date;
	endedAt?: Date;
};

export function recurrencesCollection(db: Db) {
	return db.collection<RecurrenceDoc>("recurrences");
}
