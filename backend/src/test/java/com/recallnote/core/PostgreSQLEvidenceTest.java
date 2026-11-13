package com.recallnote.core;

import static org.junit.jupiter.api.Assertions.*;
import java.sql.DriverManager;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/** Uses a dedicated schema in the explicitly supplied disposable test database. */
@EnabledIfEnvironmentVariable(named="TEST_DB_URL", matches=".+")
class PostgreSQLEvidenceTest {
    @Test void migrationPreservesOldEvidenceAndApprovalCopiesEveryPassage() throws Exception {
        String schema="evidence_test_"+UUID.randomUUID().toString().replace("-","");
        String url=System.getenv("TEST_DB_URL"), user=System.getenv("TEST_DB_USER"), password=System.getenv("TEST_DB_PASSWORD");
        try(var connection=DriverManager.getConnection(url,user,password)) {
            var db=new JdbcTemplate(new SingleConnectionDataSource(connection,true));
            try {
                Flyway.configure().dataSource(url,user,password).schemas(schema).defaultSchema(schema).target("8").load().migrate();
                connection.setSchema(schema);
                UUID epic=UUID.randomUUID(), run=UUID.randomUUID(), proposal=UUID.randomUUID(), record=UUID.randomUUID(), oldQuest=UUID.randomUUID();
                db.update("INSERT INTO epic(id,user_id,title,completion_criteria) VALUES (?,'dev-user-001','Career','Review')",epic);
                db.update("INSERT INTO record(id,user_id,title,content_markdown,tags_json) VALUES (?,'dev-user-001','Twin','First action. Later verification.','[\"project:Twin\"]')",record);
                db.update("INSERT INTO agent_run(id,user_id,epic_id,status) VALUES (?,'dev-user-001',?,'SUCCEEDED')",run,epic);
                db.update("INSERT INTO quest_proposal(id,run_id,epic_id,user_id,title,description,steps_json,completion_criteria,result_markdown) VALUES (?,?,?,'dev-user-001','Twin','Outcome','[\"Review\",\"Verify\"]','Verified','# Result')",proposal,run,epic);
                db.update("INSERT INTO proposal_evidence(proposal_id,record_id,record_version,excerpt) VALUES (?,?,1,'First action.')",proposal,record);
                db.update("INSERT INTO quest(id,user_id,epic_id,source_proposal_id,title,description) VALUES (?,'dev-user-001',?,?,'Legacy','Old result')",oldQuest,epic,proposal);
                db.update("INSERT INTO quest_evidence(quest_id,record_id,record_version) VALUES (?,?,1)",oldQuest,record);
                Flyway.configure().dataSource(url,user,password).schemas(schema).defaultSchema(schema).load().migrate();
                assertEquals("First action.",db.queryForObject("SELECT excerpt FROM quest_evidence WHERE quest_id=?",String.class,oldQuest));
                // Use a new proposal for approval; the migrated legacy result remains unchanged.
                UUID nextProposal=UUID.randomUUID();
                db.update("INSERT INTO quest_proposal(id,run_id,epic_id,user_id,title,description,steps_json,completion_criteria,result_markdown) SELECT ?,run_id,epic_id,user_id,title,description,steps_json,completion_criteria,result_markdown FROM quest_proposal WHERE id=?",nextProposal,proposal);
                db.update("INSERT INTO proposal_evidence(proposal_id,record_id,record_version,excerpt) SELECT ?,record_id,record_version,excerpt FROM proposal_evidence WHERE proposal_id=?",nextProposal,proposal);
                proposal=nextProposal;
                db.update("INSERT INTO proposal_evidence(proposal_id,record_id,record_version,excerpt) VALUES (?,?,1,'Later verification.') ON CONFLICT DO NOTHING",proposal,record);
                assertEquals(0,db.update("INSERT INTO proposal_evidence(proposal_id,record_id,record_version,excerpt) VALUES (?,?,1,'Later verification.') ON CONFLICT DO NOTHING",proposal,record));
                ApiController.CURRENT_USER.set("dev-user-001");
                var api=new ApiController(db,"http://localhost:1","key","unused");
                assertEquals(List.of("project:Twin"),api.get(record).get("tags"));
                assertEquals(2,((List<?>)api.proposal(proposal).get("evidence")).size());
                var decision=api.decision(proposal,Map.of("action","ACCEPT"));
                UUID approved=UUID.fromString(decision.get("questId").toString());
                assertEquals(2,db.queryForObject("SELECT count(*) FROM quest_evidence WHERE quest_id=?",Integer.class,approved));
                var quest=api.quests().stream().filter(row -> row.get("id").equals(approved)).findFirst().orElseThrow();
                assertEquals(List.of(record.toString()),quest.get("recordIds"));
                assertEquals(2,((List<?>)quest.get("evidence")).size());
            } finally {
                ApiController.CURRENT_USER.remove();
                connection.setSchema("public");
                db.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE");
            }
        }
    }
}
