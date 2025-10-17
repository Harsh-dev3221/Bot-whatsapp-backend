export type WorkflowTemplate = {
  key: string;
  name: string;
  description: string;
  workflow: any;
};

// Pre-built workflow templates (Phase 1)
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'valve_product_inquiry',
    name: 'Valve Company - Product Inquiry',
    description: 'Collects customer details and product inquiry with quantity and notes, then saves as inquiry.',
    workflow: {
      workflow_type: 'custom',
      status: 'published',
      is_active: true,
      trigger: { keywords: ['inquiry', 'product', 'valve', 'catalog'] },
      ai_context: {
        instructions: 'Help the user inquire about valve products. Keep responses concise and clarify missing details.',
      },
      steps: [
        { id: 's1', type: 'collect_field', prompt_message: 'Your name, please?', collect_config: { field_key: 'name' } },
        { id: 's2', type: 'collect_field', prompt_message: 'What is your email?', collect_config: { field_key: 'email' } },
        { id: 's3', type: 'collect_field', prompt_message: 'Your address?', collect_config: { field_key: 'address' } },
        { id: 's4', type: 'collect_field', prompt_message: 'Which product are you interested in?', collect_config: { field_key: 'product' } },
        { id: 's5', type: 'collect_field', prompt_message: 'Quantity needed?', collect_config: { field_key: 'quantity' } },
        { id: 's6', type: 'collect_field', prompt_message: 'Any additional notes?', collect_config: { field_key: 'notes' } },
      ],
      actions: [{ type: 'save_to_database', table: 'inquiries' }],
    },
  },
  {
    key: 'salon_appointment_booking',
    name: 'Salon - Appointment Booking',
    description: 'Collects service selection and timeslot preference — basic version without time slot validation.',
    workflow: {
      workflow_type: 'custom',
      status: 'published',
      is_active: true,
      trigger: { keywords: ['book', 'booking', 'appointment', 'salon'] },
      ai_context: { instructions: 'Assist with salon appointment booking.' },
      steps: [
        {
          id: 's1',
          type: 'show_options',
          prompt_message: 'Which service would you like? ',
          options_config: {
            field_key: 'service',
            options: [
              { label: 'Haircut', value: 'haircut' },
              { label: 'Manicure', value: 'manicure' },
              { label: 'Facial', value: 'facial' },
            ],
          },
        },
        { id: 's2', type: 'collect_field', prompt_message: 'Preferred date (YYYY-MM-DD)?', collect_config: { field_key: 'date' } },
        { id: 's3', type: 'collect_field', prompt_message: 'Preferred time (HH:mm)?', collect_config: { field_key: 'time' } },
        { id: 's4', type: 'collect_field', prompt_message: 'Your name?', collect_config: { field_key: 'name' } },
        { id: 's5', type: 'collect_field', prompt_message: 'Contact number?', collect_config: { field_key: 'phone' } },
      ],
      actions: [{ type: 'save_to_database', table: 'inquiries' }],
    },
  },
  {
    key: 'restaurant_reservation',
    name: 'Restaurant - Reservation',
    description: 'Collects party size, date and time for a simple reservation capture.',
    workflow: {
      workflow_type: 'custom',
      status: 'published',
      is_active: true,
      trigger: { keywords: ['reserve', 'table', 'reservation', 'restaurant'] },
      ai_context: { instructions: 'Assist with restaurant reservations.' },
      steps: [
        { id: 's1', type: 'collect_field', prompt_message: 'How many people?', collect_config: { field_key: 'party_size' } },
        { id: 's2', type: 'collect_field', prompt_message: 'Preferred date (YYYY-MM-DD)?', collect_config: { field_key: 'date' } },
        { id: 's3', type: 'collect_field', prompt_message: 'Preferred time (HH:mm)?', collect_config: { field_key: 'time' } },
        { id: 's4', type: 'collect_field', prompt_message: 'Your name?', collect_config: { field_key: 'name' } },
        { id: 's5', type: 'collect_field', prompt_message: 'Contact number?', collect_config: { field_key: 'phone' } },
      ],
      actions: [{ type: 'save_to_database', table: 'inquiries' }],
    },
  },
];

