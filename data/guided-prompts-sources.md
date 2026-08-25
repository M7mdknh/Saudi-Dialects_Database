# Guided prompt bank: sources and method

## Deliverable

`guided-prompts.ar.json` contains the original 96 Arabic concept-elicitation prompts. `guided-prompts.sa.ar.json` expands the bank to 300 prompts for the Saudi-only Lahajat AI contribution flow. The prompt wording, definitions, and situations were newly authored for this project. They do not reproduce dialect answers from another lexicon.

The Saudi expansion adds food and cooking, clothing, health, kinship, study and work, shopping, roads, public places, weather, agriculture, livestock, desert trips, technology, household work, social occasions, descriptions, and conversational phrases.

## Source policy

### Concepticon 3.4.0

- Role: reusable concept-list backbone and semantic-disambiguation method.
- License: Creative Commons Attribution 4.0.
- Use here: informed selection of basic, comparable concepts. The Arabic scenarios and definitions in the seed file are project-authored adaptations.
- Attribution: List, Johann Mattis et al. (eds.). 2026. _CLLD Concepticon 3.4.0_. Zenodo. https://doi.org/10.5281/zenodo.21373838
- Project: https://concepticon.clld.org/

### MADAR Arabic Dialect Corpus and Lexicon

- Role: research evidence that concept-aligned elicitation works across fine-grained Arabic city dialects and that MSA-only starting text can bias responses.
- Use here: methodology and category prioritization only.
- Important restriction: the downloadable MADAR data permits internal research/evaluation and disallows redistribution and modification without additional permission. No MADAR lexicon entries or dialect translations are copied into this seed file.
- Paper: Bouamor, Houda et al. 2018. _The MADAR Arabic Dialect Corpus and Lexicon_. https://aclanthology.org/L18-1535/
- Official download/license page: https://camel.abudhabi.nyu.edu/madar-parallel-corpus/

### SADA corpus study

- Role: recent evidence that dialects differ systematically in frequent discourse markers, evaluative expressions, and recurrent phrases, not only rare nouns.
- Use here: raised the priority of question words, particles, degree expressions, and common conversational phrases.
- Paper: Alfattni, Ghada. 2026. _A Corpus-Based Investigation of Contemporary Arabic Dialects Using the SADA Corpus_. https://aclanthology.org/2026.abjadnlp-1.35/

### Saudi ASWAT

- Role: defines the current nationwide Saudi scope used by the project.
- Coverage: five major Saudi regional varieties—Najdi/Central, Eastern, Hijazi/Western, Northern, and Southern—covering more than 55 local varieties.
- Use here: the five varieties are leaderboard parent groups only. The submitted city/local dialect label remains preserved beneath them.
- Privacy decision: do not require tribal identity. Ask for a city, governorate, or local dialect name instead.
- Paper: Alharbi, Abdullah I. et al. 2026. _Saudi ASWAT: A Large-Scale Corpus of Spontaneous Saudi Arabic Speech_. https://lrec.elra.info/lrec2026-main-124
- Official project page: https://ksaa.gov.sa/en/initiatives/50869-Aswat-Corpus

### Arabic WordNet / Open Multilingual Wordnet

- Role: possible future source for sense identifiers and broader MSA synonym validation.
- License: Arabic WordNet in OMW is CC BY-SA 3.0.
- Use here: not incorporated into the current prompt text, avoiding ShareAlike implications until the project chooses a compatible licensing policy.
- Resource: https://omwn.org/omw1.html

## Elicitation rules

1. Show `msa_lemma` as the reference concept, but emphasize `scenario_ar` so the contributor answers naturally rather than translating mechanically.
2. Do not display known dialect answers before the contributor responds.
3. Keep the contributor's dialect selection between prompts.
4. Allow three valid response kinds: a different dialect expression, the same expression as MSA, or multiple natural expressions.
5. Treat “I do not know” as a skip, not as linguistic data.
6. Store `prompt_id` and `prompt_version` with every guided response.
7. Never silently change the meaning of an existing prompt. Create a new prompt version when the intended sense or scenario changes.
8. Draw from the full Saudi bank using priority and coverage gaps. Rotate categories instead of showing several near-identical prompts together.
9. Have native speakers from several target dialects review ambiguity before public launch.
10. Track completion, skip, same-as-MSA, and disagreement rates per prompt. Disable or rewrite prompts with abnormal disagreement or skip rates.

## Suggested Saudi launch selection

- Use the five Saudi parent groups only for aggregate coverage and leaderboards.
- Preserve city, governorate, and local dialect labels exactly as submitted.
- Begin with a rotating mix of priority-100 prompts rather than showing them in a fixed order.
- Add priority-90 and priority-80 prompts automatically when they fill a missing category or dialect coverage gap.
- Show six prompts before the free-entry form and four after a successful contribution.
- Mix at least four categories in every displayed set.
