- Finishing from questionnaire to brand guidelines document to finalizing project to quote document to landing the project

Step 1: Client fills questionnaire

- We should have API listener to listen to Google form submissions using Google apps script trigger or uploaded filled document (for upload filled document we just parse in frontend and prefill form fields then user can click on form to submit) or fill form directly from UI and automatically create a brand origin document [templates will be given to you as context]. Rules, example documents of filled and non filled questionaire would also be given as context for AI.

* We should inform the PM in email and we have a ‘Pending Projects’ project in asana where the new pending project will be created as a task and PM assigned to it.

- In our db we store the 'Pending Projects' project id but we also have code to check if it exists in db else create and save in db to ensure other actions in code doesn't break. The 'Pending Projects' project with a board that has this columns
  Filled Questionaire,
  Brand Origin Doc Phase,
  Quote Document Phase,
  Finalized,
  Rejected

We also want to track these pending projects board changes via webhook but minimally, like when a task is moved, comments and details of a task, track columns and tasks in it, and details to so we updated changes in our db. When creating ‘Pending Projects’ project create the webhook for it too with necessary listeners/filters.

Step 2: If questionnaire is from google form, we send an email to client that we have received it.

- We also create brand origin document in cron job and when completed inform PM via email and project task (in ‘Pending Projects’ board) is moved to “Brand Origin Doc Phase” column in ‘Pending Projects’ board.
- New comment is added in task (specifically for the project in ‘Pending Projects’ board) with PM tagged and informed of the created brand origin document, telling PM to go to email to review or send to client.
- The email notification will have a ‘Review’ button and ‘Send to Client’ button. On click of review they can make changes to the document and come back to email/or still in UI to click “Send To Client’

- PM can make tweaks and accept brand origin document

- We need the best, cheap/free way of tracking document changes even if it means every version is a new file entirely in backend. But we need this stored and the mechanism stored should allow docs content be accessible to AI. Also sync changes properly similarly like how Google Docs works.

Step 3: When PM clicks “Send To Client” Client receives the accepted brand origin via email and a dedicated email extension for reply-to for the client for email listeners maybe clients-<CLIENT_ID>-<PROJECT_ID>@levitate.ng (We can use brevo inbound webhook here for the email listener or what works best)

Step 4: In the inbound email listener, when a new email is received, we detect cient ID from email to identify client from db and if detected intent is a rework/modification to the doc, while brand origin document is not in accepted status, take any email response as feedback to detect intent by LLM and recreate the brand origin document if needed and adjust details of brand origin or know if brand origin document is accepted by client or know if intent is a conversation not related to the document sent etc. Then if the detected intent is relating to modification to the document then repeat Step 2 - 4 till brand origin document is accepted status by client then proceed to step 5.

- So we need to track status of document and changes, we also need to track status/current phase of client project.

Step 5: If you detect that Brand origin document is accepted by client based on the email intent or manually if clicked from Admin UI to accepted - Send confirmation email to Finance Manager and Admin to confirm with a button in email (any of them can click must not be both) and when clicked starts cron job for creating the Quote document via ERP software API (if cron job already in process don't rerun incase both click button same time) and when document complete move project to "Quote Document Phase" column in 'Pending Projects' board (You only send confirmation email to Finance Manager and Admin if not clicked from Admin UI i.e accepted status wasn't API triggered but detected intent from email)

- We store the Quote ID returned from the ERP software API in our db.
- Also add new comment on task and tag Finance Manager that "Quote" document created telling person to go to email to review or send to client but don't attach the link to quote document in the asana task comment.
- The email notification will have a 'View' button and 'Send to Client' and "manage" button. On click of view they go to link of quotes document that has been uploaded to drive and can come back to email/or still in UI to click "Send To Client', manage button just go to UI.

- Example Quote Document, rate card and rules in creating one will be given as context.

- In the Email sent to Admin & Finance Manager, We also create 3 variations of ideal Quote document via ERP software API and attach links in email as suggestions based on the context and rules given to AI on creating this document and details/context of client data. We store the variant IDs returned from the ERP software API in our db. These variation documents are only created once for this Quote document initial generation; we don't recreate variations in any subsequent modification to the document based on email listener that detects intent and decides to create, we only recreate Quote document based on detected intent if need be and choose based on the selected variant sent to client.

Step 6: In the email listener, when a new email is received, we detect cient ID from email to identify client from db and if detected intent is a rework/modification to the doc, while 'Quote' document is not in accepted status, take any email response as feedback to detect intent by LLM and recreate the 'Quote' document via ERP software API if needed and adjust details of quote document or know if quote document is accepted by client or know if intent is a conversation not related to the document sent etc. Then if the detected intent is relating to modification to the document then repeat Step 5 - 6 till 'Quote' document is in accepted status by client then proceed to step 7.

- So we need to track status of document and changes, we also need to track status/current phase of client project.

Step 7: If you detect that Quote document accepted by client based on the email intent or manually if clicked from Admin UI to accepted - Send confirmation email to Admin and Finance Manager to confirm with a button in email and when clicked starts move the project task on 'Pending Project' project board to "Finalized" column. (You only send confirmation email to Admin and Finance Manager if not clicked from Admin UI i.e accepted status wasn't API triggered but detected intent from email)

- You also start cron job for creating project on asana (This signifies the project is kicking of officially as an actual project and has ben secured)
- The new project board will have columns: "To Do", "In Progress", "In Review", "Completed"
- We would have team members, their roles, asana id, email etc on db one or more people can be on a role for example Graphics Designer can be two people but one will have status of Lead so that person would be default assigned on project. Only one team member per role can have a lead status. A team member can have different roles like a Graphics Designer and a web developer.
  This are the roles we know of now but subject to change/modification in the future:
- Admin (should not be assigned task)
- Manager (should not be assigned task)
- Web designer
- Graphics Designer
- Creative director - Role: Chooses the best execution strategy and brand perfect for the client
- UI designer (figma)
- Project manager. - Role:Client relationships & following up with the team. Assigning tasks to team members.
- Copy writer
- Digital marketers - role: Create the advertising plan / social media marketing
- Motion graphics design
- Finance Manager

- You will use AI to determine which team members to add to the project on Asana based on the project requirements. When deciding on team members to add to project on Asana find: People with skills for that project and people that have lesser work assigned to them.
- You will add the selected team members to the project on Asana but you will not assign anyone tasks yet.
- You will also add a project description in the project description in Asana about everything we know about the project to help teams - excluding financials. This should include all context about the client, project requirements, brand guidelines, conversations, and any other relevant information that would help the team understand the project better.

Step 8: This is where we will generate workplan and add it as a task to the project on Asana, Then assign creative director in the project to the task or if no creative director in project in Asana we assign it to the Lead creative director from the tem members list.

Step 9: After step 7 complete send email to Admin and Manager (if anyone on that role) and PM of the project via email, letting them know project has been initialized and team members have been added to the Asana project.

Note:

1. We should store variations of created brand origin documents and quote documents for reference purposes and context to LLM to improve on if detected intent from email conversation is to recreate.

- For brand origin documents, we need the best, cheap/free way of tracking document changes even if it means every version is a new file entirely in backend (Similarly to how Google docs works). But we need this stored and the mechanism stored should allow docs content be accessible to AI.
- For quote documents, we track changes via the ERP software API and store the document IDs and variant IDs in our db for reference and context to LLM.

2. We should store the conversation between the client and Levitate Studios. For better context to AI - Admin can also add more context for that client, uploaded or typed in through UI.
3. All conversation, messages, context docs, variations of doc created etc. should be stored timestamped when it happened and when created in db so we know order.
4. We want apis to respond immediately and all actions that takes time or multiple LLM calls like document creation process, asana project initialization etc. happens as cronjobs with retry logic, status checking etc.
5. The Context given to AI for creating document and performing its activities, creative thinking process of human etc. can be in form of text and documents.
6. Its good for you to know what service we (Levitate Studios) offer, which are but not limited to:

- Logo
- Web design
- Packaging design
- Motion graphics
- Advertising

7. A client can have multiple pending projects or real projects running so we need to know for which project per the client to act on.
8. We have a dashboard where Admin or manager can do so many of these actions from UI, like see current state of a project, manually click to move docs to accepted, add more context of a client or project via a text area etc.
9. You will use LLM tool calls for web search, document reading (preferrably we just put document context as text for easy reading and referencing) etc. during LLM calls to give the best answer. So categorize properly for little tasks and complex tasks. If a task is complex execute it in parts and return and compile than too many context to llm which miight exceed context limit and cause LLM to hallucinate in its output.
10. Code should be ordered in separation of concerns per services, actions etc for high maintainability and possible future change of requirements.
11. DB should be well architected.
12. We want to log every important actions we do per project so admin can view the logs per project and know what phase it is at a time. These actions will be timestamped
13. We need to handle edge cases where a project task in “Pending Projects” board is deleted. We also delete on db
14. ASANA HIREACHY:
    Project → Board/List (view) → Columns/Sections → Tasks → Subtasks.
15. In the broader implementation we want to break huge LLM calls to smaller sections and chain results with proper evaluation, retry and guardrails. With also tools that run programmatically and return expected response/error format (https://www.anthropic.com/engineering/building-effective-agents)
16. See here to get insights on structuring system prompts. https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools
