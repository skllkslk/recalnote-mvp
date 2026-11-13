-- Preserve all selected source passages, including multiple passages from one record.
ALTER TABLE proposal_evidence ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE proposal_evidence DROP CONSTRAINT proposal_evidence_pkey;
ALTER TABLE proposal_evidence ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX proposal_evidence_passage_idx
    ON proposal_evidence (proposal_id, record_id, record_version, md5(excerpt));

ALTER TABLE quest_evidence ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE quest_evidence ADD COLUMN excerpt text NOT NULL DEFAULT '';
UPDATE quest_evidence qe SET excerpt = pe.excerpt
FROM quest q, proposal_evidence pe
WHERE q.id = qe.quest_id AND pe.proposal_id = q.source_proposal_id
    AND pe.record_id = qe.record_id AND pe.record_version = qe.record_version;
ALTER TABLE quest_evidence DROP CONSTRAINT quest_evidence_pkey;
ALTER TABLE quest_evidence ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX quest_evidence_passage_idx
    ON quest_evidence (quest_id, record_id, record_version, md5(excerpt));
