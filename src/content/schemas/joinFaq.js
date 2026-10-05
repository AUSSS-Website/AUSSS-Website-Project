import { joinFaqs } from '../../data/faq.js'

// The questions at the bottom of /join. Edited by the EB.
export default {
  key: 'join.faq',
  title: 'Join page: questions and answers',
  description: 'The frequently asked questions at the bottom of the Join us page.',
  path: '/join',
  editors: [],
  fields: [
    {
      name: 'items',
      type: 'list',
      label: 'Questions',
      itemLabel: 'question',
      titleField: 'q',
      min: 1,
      max: 30,
      fields: [
        { name: 'q', type: 'text', label: 'Question', required: true, max: 160 },
        {
          name: 'a',
          type: 'markdown',
          label: 'Answer',
          required: true,
          max: 1200,
          help: 'Keep it to a short paragraph. Do not put this year’s fee or dates here: they are announced with each recruitment round.',
        },
      ],
    },
  ],
  defaults: { items: joinFaqs },
}
